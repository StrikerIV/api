const bodyParser = require("body-parser");
const favicon = require('serve-favicon');
const FormData = require('form-data');
const express = require("express");
const jwt = require('jsonwebtoken');
const axios = require("axios");
const path = require('path');

const { initialize } = require('./structures/DatabaseConnections');
const config = require("./utils/config.json")
const PORT = process.env.PORT || 5000

const app = express()

const { getConnection, postConnection, deleteConnection } = initialize()
const currentAPIVersion = config.currentAPIVersion

//functions
function FieldsParser(fields) {
    if (!fields) return null;
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
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

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

            if (!data.username) {
                return res.redirect("/api/v1/auth")
            }

            if (!data.mfa_enabled) {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
            }

            return res.status(200).send({ "token": jwt.sign(data.id, config.session.secret) })
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
                return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
            }
        }

        if (requestUrl[2] == "database") {
            //path is /api/v{}/database
            //also eval authorization

            if (!req.headers.authorization) {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
            }

            let bearerToken = req.headers.authorization.split(" ")

            if (bearerToken[0] != "Bearer") {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
            }

            let token = jwt.verify(bearerToken[1], config.session.secret, function (err, decoded) {
                return err ? null : decoded
            });

            if (!token) {
                return res.status(401).send({ "message": "401: Unauthorized", "code": 0 })
            }

            if (requestMethod === "GET") {
                let query = req.body.query
                let params = req.body.params

                if (!query || !params) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 0 })
                }

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

                postConnection.query(query, params, function (error, results, fields) {
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

                postConnection.query(query, params, function (error, results, fields) {
                    let getQuery = QueryParser(error, results, fields)

                    if (getQuery.error) {
                        return res.status(400).send(getQuery)
                    } else {
                        return res.status(200).send(getQuery)
                    }
                });

                return;
            } else if (requestMethod === "DELETE") {
                let query = req.body.query
                let params = req.body.params

                if (!query || !params) {
                    return res.status(400).send({ "message": "400: Bad Request", "code": 0 })
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
            }
        } else {
            return res.status(404).send({ "message": "404: Not Found", "code": 0 })
        }

    }

});

app.listen(PORT, function () {
    console.log(`Express server listening on port ${PORT}`)
})