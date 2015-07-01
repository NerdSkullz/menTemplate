var gulp = require('gulp'),
    concat = require('gulp-concat'),
    config = require('config'),
    nodemon = require('gulp-nodemon');


gulp.task('scripts', function() {
  return gulp.src('app/assets/javascript/*.js')
    .pipe(concat('app.js'))
    .pipe(gulp.dest('public'));
});

gulp.task('server', function (cb) {
  exec('node server.js', function (err, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    cb(err);
  });
  exec('mongod --dbpath ./data', function (err, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    cb(err);
  });
})

gulp.task('default', ['scripts'] , function () {
  gulp.watch('app/assets/javascript/*.js', ['scripts']);
  nodemon({ script: 'server.js',
            ext: 'html js',
            tasks: ['default'] })
    .on('restart', function () {
      console.log('restarted!')
    })
})