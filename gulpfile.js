var gulp = require('gulp'),
    concat = require('gulp-concat'),
    exec = require('child_process').exec;


function runCommand(command) {
  return function (cb) {
    exec(command, function (err, stdout, stderr) {
      console.log(stdout);
      console.log(stderr);
      cb(err);
    });
  }
}

gulp.task('watch', function() {
  gulp.watch('./app/assets/javascript/*.js', ['scripts']);
})    

gulp.task('scripts', function() {
  return gulp.src(['app/assets/javascript/*.js'])
    .pipe(concat('app.js'))
    .pipe(gulp.dest('public'));
});

// Start MongoDb

gulp.task('start-mongo', runCommand('mongod --dbpath /data/'));
gulp.task('start-app', runCommand('npm start'));

gulp.task('default', ['start-mongo', 'start-app', 'watch'] , function () {
  
})
