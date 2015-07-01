assets-middleware
=================

Abstract Express/Connect middleware for dealing with static assets like JS and CSS

Higher-level middleware (like LESS, Stylus, Coffeescript compilation, minifying, etc) or combinations of them can be built on top of this.

## Installation

```bash
npm install assets-middleware
```

## Usage

Here is an example that takes `.coffee` and `.js` files from the `./public` directory and the `./lib/jquery.js` file, calls `compile` on any CoffeeScript files, and then calls `minify` on the concatenated content.

```js
var app = require('express')();
var assets = require('assets-middleware');

app.get('/my-scripts.js', assets({
    src : [ './public', './lib/jquery.js' ],
    pipeline : {
        prefilter : [ 'coffee', 'js' ],
        // don't include CSS files. You could use [ 'less', 'css' ] for them

        // compile any .coffee files
        mapContent : function(content, file, next) {
            file.extname === '.coffee' ?
                compile(content, next) :
                next(null, content);
        },

        // minify the batch
        postReduceContent : function (concatenatedContent, next) {
            minify(concatenatedContent, next);
        }
    }
}));

app.listen(8080);
```

## Options

| Option     | Default          | Allowed values | Description
|------------|------------------|----------------|-------------|
| `dest`     | `identitySync`   | `path`, `function(path) : path`               | The file path to write the resulting asset to. |
| `src`      | `'./public'`     | `path`, `[path]`, `function(path, callback)`  | The file paths and directories to read from. The passed in path is the destination file |
| `prefix`   | `'/'`            | `string`                                      | A prefix to remove from the URL path when converting it to a local file path. This is called before dest |
| `encoding` | `'utf8'`         | `string`                                      | The encoding to use for reading and writing files. |
| `force`    | `'ifnewer'`      | `true`, `false`, `'ifnewer'`                  | Where to force regeneration on every request (`true`), if the last generated file is older than any source file (`'ifnewer'`) or only if the file doesn't exist (`false`) |
| `serve`    | `true`           | `true`, `false`                               | Whether to serve the generated file. If set to false, you'll have to use a static middleware to serve the file yourself. |
| `logger`   | `null`           | `function(string, level)`                     | An optional logger function that is called with a string output and string log level (`'error'`, `'warn'`, `'info'`, `'debug'`) |
| `pipeline` | streamy pipeline | `Object`                                      | An object where each key is a step and its value is the function to execute. See the pipeline tables below |

### Pipeline - Stringy

| Step                | Default     | Allowed values                                         | Description |
|---------------------|-------------|--------------------------------------------------------|-------------|
| `prefilter`         | `asyncTrue` | `extension`, `[extension]`, `function(file, callback)` | This step offers a way to filter out files that shouldn't be included before any heavy processing is done. It can be a function, or use the extension-filtering shorthand. |
| `mapContent`        | `identity`  | `function(content, file, callback)`                    | This step is where you transform the input content into output content. |
| `filter`            | `asyncTrue` | `function(file, callback)`                             | This step offers you a last ditch spot to exclude files from the output. You will rarely need to specify this step. |
| `postReduceContent` | `identity`  | `function(content, callback)`                          | This step is where you can act on the combined content of all your source files. |

### Pipeline - Streamy

| Step                | Default     | Allowed values                                         | Description |
|---------------------|-------------|--------------------------------------------------------|-------------|
| `prefilter`  | `asyncTrue`            | `extension`, `[extension]`, `function(file, callback)` | This step offers a way to filter out files that shouldn't be included before any heavy processing is done. It can be a function, or use the extension-filtering shorthand. |
| `map`        | `identity`             | `function(content, file, callback)`        | This step is where you transform the input content into output content. |
| `filter`     | `asyncTrue`            | `function(file, callback)`                 | This step offers you a last ditch spot to exclude files from the output. You will rarely need to specify this step. |
| `reduceSeed` | `createWritableStream` | `function(path, callback)` | Generate a Writable stream from the output file path. |
| `reduce`     | `pipe`                 | `function(writable, readable, callback)`   | Pipe your Readable stream into the Writable stream. |
| `postReduce` | `identity`             | `function(content, callback)`              | This step is where you can act on the combined content of all your source files. |

## Standard parameter shapes

| Parameter   | Shape    |
|-------------|----------|
| `extension` | `string` |
| `path`      | `string` |
| `content`   | `string` |
| `file`      | `{ path : string, stat : stat, extname : string, mapped : ?* }` |
| `seed`      | `Writable`, `{ path : string, content : string }` |
| `callback`  | `function(err, result)` |

* Note that "mapped" is only present in a `file` after the map step. In the stringy pipeline, it's a content string. In the streamy pipeline, it's a `Readable` stream.

## Tutorial

We're going to set up a basic compile + minify filter. Step one is to pick our source directories and files:

```js
app.get('/my-scripts.js', assets({
    src : [ './public', './lib/jquery.js' ]
}));
```

We can choose a destination too. The default is to use the URL path, relative to the current working directory.

```js
app.get('/my-scripts.js', assets({
    src : [ './public', './lib/jquery.js' ],
    dest : './new-location.js'
}));
```

The above example would take all the files in `./public` and the single `./lib/jquery.js` file and
concatenate them into `./my-location.js`. This is of somewhat questionable value since CSS and JS files
that exist under `./public` would all be included in the same output.

So let's work with this a bit more. assets-middleware gives you an optional pipeline for transforming your files. You can `prefilter` files based on the path, `map` to transform the content, `filter` them again if necessary, and `reduce` to combine them.

So let's filter out just the JS and skip CSS files. We can do this in our "prefilter" step:

```js
app.get('/my-scripts.js', assets({
    pipeline : { prefilter : 'js' },
    src : [ './public', './lib/jquery.js' ], // specify the source files
}));
```

But maybe you like CoffeeScript. Let's include those too, and compile them in the "mapContent" step of the
pipeline:

```js
var path = require('path');
var fs = require('fs');
var coffee = require('coffee-script');
function compile(code, next) {
    try {
        next(null, coffee.compile(code));
    } catch(e) { // compile error
        next(e);
    }
}

app.get('/my-scripts.js', assets({
    pipeline : {
        prefilter : [ 'coffee', 'js' ],
        mapContent : function(content, file, next) {
            file.extname === '.coffee' ?
                compile(content, next) :
                next(null, content);
        }
    },
    src : [ './public', './lib/jquery.js' ]
}));
```

And you want it minified? Well then we should do that in the `postReduceContent` step:

```js
var uglify = require('uglify-js');
function minify(code, next) {
    try {
        next(null, uglify.minify(code, { fromString : true }).code);
    } catch (e) {
        next(e);
    }
}

app.get('/my-scripts.js', assets({
    pipeline : {
        prefilter : [ 'coffee', 'js' ],
        mapContent : function(content, file, next) {
            file.extname === '.coffee' ?
                compile(content, next) :
                next(null, content);
        },
        postReduceContent : function (concatenatedContent, next) {
            minify(concatenatedContent, next);
        }
    },
    src : [ './public', './lib/jquery.js' ]
}));
```

And you're done!

## Changelog

| Version | Changes |
|---------|---------|
| 0.0.3   | Add `serve` option and ignore destination file when in a source directory. |
| 0.0.2   | Respect falsy `force` values |
| 0.0.1   | Initial npm publish |