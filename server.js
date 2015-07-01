
/**
 * Module dependencies
 */

var fs = require('fs'),
    express = require('express'),
    mongoose = require('mongoose'),
    passport = require('passport'),
    config = require('config'),
    sass = require('node-sass'),
    sassMiddleware = require('node-sass-middleware');

var app = module.exports = express();

// adding the sass middleware
app.use(
   sassMiddleware({
       src: __dirname + '/app/assets/stylesheet', 
       dest: __dirname + '/public',
       debug: true,       
   })
);

var port = process.env.PORT || 3000;

// Connect to mongodb
var connect = function () {
  var options = { server: { socketOptions: { keepAlive: 1 } } };
  mongoose.connect(config.db, options);
};
connect();

mongoose.connection.on('error', console.log);
mongoose.connection.on('disconnected', connect);

// Bootstrap models
fs.readdirSync(__dirname + '/app/models').forEach(function (file) {
  if (~file.indexOf('.js')) require(__dirname + '/app/models/' + file);
});

// Bootstrap passport config
require('./config/passport')(passport, config);

// Bootstrap application settings
require('./config/express')(app, passport);

// Bootstrap routes
require('./config/routes')(app, passport);

app.listen(port);
console.log('Express app started on port ' + port);
