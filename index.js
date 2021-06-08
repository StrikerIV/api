const toxicity = require('@tensorflow-models/toxicity');
const tf = require('@tensorflow/tfjs-node');
const { spawn } = require('child_process');
const favicon = require('serve-favicon');
const jwt = require('jsonwebtoken');
const express = require("express");
const sharp = require('sharp');
const axios = require("axios");
const path = require('path');
const fs = require('fs');

const { initialize } = require('./structures/DatabaseConnections');
const config = require("./utils/config.json");
const { URLSearchParams } = require('url');
const PORT = process.env.PORT || 5000

const app = express()

const { getConnection, postConnection, deleteConnection } = initialize()
const currentAPIVersion = config.currentAPIVersion
const threshold = 0.9;

let _toxicity

//functions
const fetchImage = async (url) => {
    return new Promise(async (result) => {
        axios.get(url, {
            responseType: 'arraybuffer'
        })
            .then(response => {
                if (!response.headers['content-type'].includes("image")) return result(null);
                let buffer = Buffer.from(response.data, 'binary')
                result(buffer)
            })
    })
}

const fetchNSFWData = async (img) => {
    const nsfw = spawn('py', ['nsfw.py', img]);

    return new Promise(async (result) => {
        nsfw.stdout.on('data', function (data) {
            nsfwData = data.toString().replace(/["']/g, '"')
            result(data.toString().replace(/["']/g, '"'))
        });
    })
}

function FieldsParser(fields) {
    if (!fields || !fields[0]) return null;
    let fieldsArray = []

    fields.forEach(field => {
        fieldsArray.push({
            database: field.db,
            table: field.table,
            name: field.name
        })
    })
    return fieldsArray
}

function QueryParser(err, res, flds) {
    fields = FieldsParser(flds)
    if (err) {
        err = {
            error: err.sqlMessage,
            code: err.code,
            sql: err.sql
        }
    }

    return QueryObject = {
        error: err,
        data: res,
        fields: fields
    }
}

app.use(favicon(path.join(__dirname, 'favicon.ico')));
app.use(require('express-session')(config.session))
app.use(express.urlencoded({ extended: true }))

app.all('*', async (req, res) => {

    let requestUrl = req._parsedUrl.pathname.trim().split("/").splice(1, req.url.length)
    let requestMethod = req.method

    if (requestUrl[0] === "") {
        return res.redirect("https://docs.kryt.xyz")
    }

    if (requestUrl[0] === "api") {
        //api requests 
        if (!requestUrl[1]) {
            //path is /api only
            return res.status(404).send({ "message": "404: Not Found", "code": 0 })
        }

        //check version of api
        if (requestUrl[1] != currentAPIVersion) {
            return res.status(404).send({ "message": "404: Not Found", "code": 0 })
        }

        //route accordingly
        if (requestUrl[2] == "auth") {
            //auth with discord to get token
            if (!req.session.bearer_token) {
                return res.redirect(`https://discord.com/api/oauth2/authorize` +
                    `?client_id=${config.oauth2.client_id}` +
                    `&redirect_uri=${encodeURIComponent(config.oauth2.redirect_uri)}` +
                    `&response_type=code&scope=${encodeURIComponent(config.oauth2.scopes.join(" "))}`)
            }

            const response = await axios(`https://discord.com/api/users/@me`, { method: "GET", headers: { Authorization: `Bearer ${req.session.bearer_token}` } })
            const data = response.data

            const guilds = await axios(`https://discord.com/api/users/@me/guilds`, { method: "GET", headers: { Authorization: `Bearer ${req.session.bearer_token}` } })

            if (!data.username) {
                return res.redirect("/api/v1/auth")
            }

            if (!data.mfa_enabled) {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 2 })
            }

            let isAdmin = config.administrators.includes(data.id)
            return res.status(200).send({ "token": jwt.sign({ id: data.id, admin: isAdmin }, config.session.secret) })
        }

        if (requestUrl[2] == "discord-callback") {
            //callback with user token
            let code = req.query.code

            if (!code) return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })

            const params = new URLSearchParams();
            params.append('client_id', config.oauth2.client_id);
            params.append('client_secret', config.oauth2.secret);
            params.append('grant_type', 'authorization_code');
            params.append('redirect_uri', config.oauth2.redirect_uri);
            params.append('scope', 'identify');
            params.append('code', code);

            try {
                const response = await axios.post('https://discord.com/api/oauth2/token', params)

                req.session.bearer_token = response.data.access_token;
                return res.redirect('/api/v1/auth');

            } catch (any) {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 1 })
            }
        }

        if (!req.headers.authorization) {
            return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
        }

        let bearerToken = req.headers.authorization.split(" ")

        if (bearerToken[0] != "Bearer") {
            return res.status(401).send({ "message": "401: Unauthorized", "code": 1 })
        }

        let token = jwt.verify(bearerToken[1], config.session.secret, function (err, decoded) {
            return err ? null : decoded
        });

        if (!token) {
            return res.status(401).send({ "message": "401: Unauthorized", "code": 2 })
        }

        if (!token.admin) {
            return res.status(403).send({ "message": "403: Forbidden", "code": 0 })
        }

        if (requestUrl[2] == "database") {

            if (requestMethod === "GET") {
                let query = req.body.query
                let params = req.body.params

                if (!query || !params) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 0 })
                }

                if (!Array.isArray(params)) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 1 })
                }


                // parse nulls client side for default values input
                params.forEach((param, index) => {
                    if (param === 'null') {
                        params[index] = null
                    }
                })

                getConnection.query(query, params, function (error, results, fields) {
                    let getQuery = QueryParser(error, results, fields)

                    if (getQuery.error) {
                        return res.status(400).send(getQuery)
                    } else {
                        return res.status(200).send(getQuery)
                    }
                });

                return;
            } else if (requestMethod === "POST") {
                let query = req.body.query
                let params = req.body.params

                if (!query || !params) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 0 })
                }

                if (!Array.isArray(params)) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 1 })
                }

                postConnection.query(query, params, function (error, results, fields) {
                    let getQuery = QueryParser(error, results, fields)

                    if (getQuery.error) {
                        return res.status(400).send(getQuery)
                    } else {
                        return res.status(200).send(getQuery)
                    }
                });

                return;
            } if (requestMethod === "DELETE") {
                let query = req.body.query
                let params = req.body.params

                if (!query || !params) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 0 })
                }

                if (!Array.isArray(params)) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 1 })
                }

                deleteConnection.query(query, params, function (error, results, fields) {
                    let getQuery = QueryParser(error, results, fields)

                    if (getQuery.error) {
                        return res.status(400).send(getQuery)
                    } else {
                        return res.status(200).send(getQuery)
                    }
                });

                return;
            } else {
                return res.status(404).send({ "message": "404: Not Found", "code": 0 })
            }
        }

        if (requestUrl[2] == "nsfw") {
            if (!req.body.image) return res.status(400).send({ error: "Missing url.", code: 0 })

            //let fileNameParts = req.body.image.split("attachments/")[1].split("/")
            //let fileName = `${fileNameParts[0] << fileNameParts[1]}.jpeg`
            let fileName = '1.jpeg'

            //get image buffer
            const imageBuffer = await fetchImage(req.body.image)
            if (!imageBuffer) return res.status(400).send({ error: "Malformed / invalid url.", code: 0 })

            await sharp(imageBuffer).toFile(`images/${fileName}`)
            let data = await fetchNSFWData(fileName)
            fs.unlink(`images/${fileName}`, (err) => { if (err) { throw err } });

            return res.json(JSON.parse(data))
        }

        if (requestUrl[2] == "toxicity") {
            if (!Array.isArray(req.body.message)) {
                return res.status(400).send({ error: "Missing message.", code: 0 })
            }

            const predictions = await _toxicity.classify(req.body.message)
            return res.status(200).json(predictions)
        }

        //return res.status(404).send({ "message": "404: Not Found", "code": 0 })
    }

});

// const load_models = async () => {
//     _toxicity = await toxicity.load(threshold)
// }

// load_models().then(() => 
app.listen(PORT, function () {
    console.log(`API listening on port ${PORT}`)
})
