const deleteInfo = require("../utils/delete.json")
const postInfo = require("../utils/post.json")
const getInfo = require("../utils/get.json");
const mysql = require("mysql")

function Initialize() {
    let getConnection = mysql.createPool(getInfo)
    let postConnection = mysql.createPool(postInfo)
    let deleteConnection = mysql.createPool(deleteInfo)

    return { getConnection, postConnection, deleteConnection }
}

module.exports.initialize = Initialize