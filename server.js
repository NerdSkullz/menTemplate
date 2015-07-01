
/**
 * Module dependencies
 */

var fs = require('fs'),
    express = require('express'),
    mongoose = require('mongoose'),
    passport = require('passport'),
    config = require('config'),
    sass = require('node-sass'),
    sassMiddleware = require('node-sass-middleware'),
    assets = require('assets')
    assetsMiddleware = require('assets-middleware');

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

// adding the js middleware
// app.use(
//    assetsMiddleware({
//        src: __dirname + '/app/assets/javascript', 
//        dest: __dirname + '/public/scripts.js',
//        debug: true,       
//    })
// );
app.get(__dirname + '/public/scripts.js', assetsMiddleware({
    src: __dirname + '/app/assets/javascript', 
    dest: __dirname + '/public/scripts.js'
}));

app.listen(port);
console.log('Express app started on port ' + port);
