var gulp = require('gulp'),
    concat = require('gulp-concat');

gulp.task('scripts', function() {
  return gulp.src(['app/assets/javascript/*.js'])
    .pipe(concat('app.js'))
    .pipe(gulp.dest('public'));
});

gulp.task('default', ['scripts'] , function () {
  gulp.watch('app/assets/javascript/*.js', ['scripts']);
})