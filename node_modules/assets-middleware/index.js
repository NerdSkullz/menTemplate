"use strict";

var path = require('path');
var fs = require('fs');
var Writable = require('stream').Writable;
var subpathIterator = require('./subpath-iterator');
var mkdirp = require('mkdirp');

var has = Object.prototype.hasOwnProperty;

function asyncTrue () { arguments[arguments.length -1](null, true); }

function identitySync(a) { return a; }
function identity(a) { arguments[arguments.length -1](null, a); }

function eq(val) { return function(a) { return a === val; }; }

function extension(exts) {
    exts = typeof exts === 'string' ? [ exts ] : exts;
    exts = exts.map(function(e) { return e.charAt(0) == '.' ? e : '.' + e; });
    return function(file, next) {
        next(null, exts.some(eq(file.extname)));
    };
}

function createWriteStream(encoding) {
    return function(filepath, next) {
        try {
            next(null, fs.createWriteStream(filepath, { encoding : encoding }));
        } catch (e) {
            next(e);
        }
    };
}

function endWriteStream(writeStream, next) {
    if (writeStream && writeStream.end) {
        writeStream.end(null, null, next);
        return;
    }
    next();
}

function createReadStream(encoding) {
    return function(pathAndStat, next) {
        if (pathAndStat.stat) {
            withStat(pathAndStat.stat);
        } else {
            fs.stat(pathAndStat.path, function(err, stat) {
                if (err) {
                    next(err);
                    return;
                }
                withStat(stat);
            });
        }

        function withStat(stat) {
            if (stat.isFile()) {
                try {
                    var s = fs.createReadStream(pathAndStat.path);
                    s.setEncoding(encoding);
                    next(null, s);
                } catch (e) {
                    next(e);
                }
                return;
            }

            next(new Error(pathAndStat.path + ' is not a file.'));
        }
    };
}

function pipe(writeStream, readStream, next) {
    readStream.once('error', next);
    readStream.once('end', function() {
        next(null, writeStream);
    });
    readStream.pipe(writeStream, { end : false });
}

function normalizeSrc(src) {
    return typeof src === 'string' ? [ src ] : src;
}

function normalizeDest(dest) {
    return typeof dest === 'string' ? function() { return dest; } : dest;
}

function defaultDest(filepath) {
    filepath = path.resolve('./out', filepath);
    if (~path.relative('./out', filepath).indexOf('..')) {
        throw new Error('Attempt to access files outside the project: ' + filepath);
    }
    return filepath;
}

function normalizePrefilter(filter) {
    return typeof filter === 'function' ?
        filter :
        extension(filter);
}

function wrapMapContent(mapContent, encoding) {
    return function map(file, next) {
        fs.readFile(file.path, encoding, function(err, content) {
            if (err) return next(err);

            mapContent(content, file, next);
        });
    };
}

function pathAndContent(path, next) {
    next(null, { path : path, content : '' });
}

function defaultReduce(encoding) {
    return function (seed, input, next) {
        var writableSeed = seed && seed.write;
        var readableInput = input.mapped && input.mapped.read && input.mapped.on && input.mapped.pipe;
        if (writableSeed && readableInput) {
            pipe(seed, input.mapped, next);
        } else if (writableSeed) {
            seed.write(input.mapped, encoding, function() { next(null, seed); });
        } else {
            if (seed && has.call(seed, 'content')) {
                if (readableInput) {
                    input.mapped.on('end', function() {
                        next(null, seed);
                    });
                    input.mapped.on('readable', function() {
                        seed.content += input.mapped.read().toString(encoding);
                    });
                } else {
                    seed.content += input.mapped;
                    next(null, seed);
                }
            } else {
                if (readableInput) {
                    input.mapped.on('end', function() {
                        next(null, seed);
                    });
                    input.mapped.on('readable', function() {
                        seed += input.mapped.read().toString(encoding);
                    });
                } else {
                    next(null, seed + input.mapped);
                }
            }
        }
    };
}

function wrapPostReduceContent(postReduceContent, encoding) {
    return function postReduce(pathAndContent, next) {
        postReduceContent(pathAndContent.content, function(err, content) {
            if (err) {
                next(err);
                return;
            }
            fs.writeFile(pathAndContent.path, content, { encoding: encoding }, next);
        });
    };
}

function defaultPostReduce(encoding) {
    return function(seed, next) {
        if (!seed) {
            next();
            return;
        }
        if (seed.write) {
            endWriteStream(seed, next);
        } else if (has.call(seed, 'path') && has.call(seed, 'content')) {
            fs.writeFile(seed.path, seed.content, { encoding: encoding }, next);
        } else {
            next(new Error('Could not handle the output of your reduce function.\n' +
                'Reduce must return a writable stream or { path : string, content : string}'));
        }
    };
}

function normalizePipeline(pipeline, encoding) {
    pipeline = pipeline || {};

    var prefilter = normalizePrefilter(pipeline.prefilter || asyncTrue);
    var map = pipeline.mapContent ?
        wrapMapContent(pipeline.mapContent, encoding) :
        pipeline.map || createReadStream(encoding);
    var filter = pipeline.filter || asyncTrue;

    var reduceSeed = pipeline.reduceSeed || (
            pipeline.postReduceContent ?
                pathAndContent :
                createWriteStream(encoding));
    var reduce = pipeline.reduce || defaultReduce(encoding);

    var postReduce = pipeline.postReduce || (
            pipeline.postReduceContent ?
                wrapPostReduceContent(pipeline.postReduceContent, encoding) :
                defaultPostReduce(encoding));

    return {
        prefilter : prefilter,
        map : map,
        filter : filter,
        reduceSeed : reduceSeed,
        reduce : reduce,
        postReduce : postReduce
    };
}

function ensureParentDirExists(filepath, whenExists, errback) {
    fs.exists(path.dirname(filepath), function(exists) {
        if (exists) whenExists();
        else mkdirp(path.dirname(filepath), function(err) {
            if (err) {
                errback(err);
                return;
            }
            whenExists();
        });
    });
}

function logFilepaths(type, logger, paths) {
    if (logger && paths) {
        var joined = paths.join ? paths.join(', ') : paths;
        logger(type + ' (' + paths.length + '): ' + joined);
    }
}

function isOlder(time, otherFilepaths, filter, next) {
    var iterator = subpathIterator(otherFilepaths);
    iterator(function handleNext(err, filepath, otherStat) {
        if (err) {
            next(err);
            return;
        }
        if (!filepath) {
            next(null, false);
            return;
        }
        if (time < otherStat.mtime) {
            filter(filepath, function(err, include) {
                if (err) {
                    next(err);
                    return;
                }
                if (include) {
                    next(null, true);
                    return;
                }
                iterator(handleNext);
            });
            return;
        }
        iterator(handleNext);
    });
}

// avoid concurrency issues by recording when a resource is being generated
// and recording any subsequent requests for that resource that happen in the meantime.
// generation[filepath] = { callbacks : [ ...function ] }
var generation = {};

function assets(options) {
    options = options || {};
    
    var logger = options.logger || null;
    var force = options.force === undefined ? 'ifnewer' : options.force;
    var src = normalizeSrc(options.src || './public');
    var dest = normalizeDest(options.dest || defaultDest);
    var prefix = options.prefix || '/';
    var encoding = options.encoding || 'utf8';
    var serve = options.serve !== false;

    var stripPrefix = prefix ? function(str) {
        if (str.substring(0, prefix.length) === prefix) {
            str = str.substring(prefix.length);
        }
        return str;
    } : identitySync;
    
    var pipeline = normalizePipeline(options.pipeline, encoding);

    var reduceSeed = pipeline.reduceSeed;
    var prefilter = pipeline.prefilter;
    var map = pipeline.map;
    var filter = pipeline.filter;
    var reduce = pipeline.reduce;
    var postReduce = pipeline.postReduce;


    function middleware(req, res, next) {
        if (req.method !== 'GET') {
            next();
            return;
        }

        var pathname = req.path;
        logger && logger('Pathname: ' + pathname, "debug");

        var pathWithoutPrefix = stripPrefix(pathname);
        logger && logger('Stripped prefix: ' + pathWithoutPrefix, "debug");

        var destpath = path.resolve(dest(pathWithoutPrefix));
        logger && logger('Serves from file path: ' + destpath, "debug");

        if (generation[destpath]) {
            logger && logger(destpath + ' is being generated by another request. Waiting.', "debug");
            generation[destpath].callbacks.push(function(err) {
                if (serve) {
                    serveResource(err, destpath, res, next);
                } else {
                    next();
                }
            });
            return;
        }
        generation[destpath] = { callbacks : [] };

        function clearGeneration(err) {
            generation[destpath].callbacks.forEach(function(cb) {
                cb(err);
            });
            delete generation[destpath];
        }

        fs.exists(destpath, function(exists) {
            if (exists) {
                fs.stat(destpath, function(err, stat) {
                    if (err) {
                        clearGeneration(err);
                        next(err);
                        return;
                    }

                    withDestStat(stat);
                });
            } else {
                ensureParentDirExists(destpath, withDestStat, next);
            }
        });

        function withDestStat(stat) {
            if (!stat) {
                logger && logger("Output file doesn't exist.", "debug");
                getSources(generateAndServe);
                return;
            }
            if (force === 'ifnewer') {
                logger && logger('Force if newer sources exist.', "debug");
                getSources(function(err, sources) {
                    if (err) {
                        clearGeneration(err);
                        next(err);
                        return;
                    }
                    checkOlderAndGenerateOrServe(stat, sources);
                });
            } else if (!force) {
                logger && logger('Not forced.' + (serve ? ' Serve existing file.' : ''), "debug");
                if (serve) {
                    serveResource(null, destpath, res, next);
                } else {
                    next();
                }
                clearGeneration();
            } else {
                logger && logger('Forced.', "debug");
                getSources(generateAndServe);
            }
        }

        function checkOlderAndGenerateOrServe(stat, sources) {
            logger && logger("Checking if existing file is older than sources", "debug");
            isOlder(stat.mtime, sources, prefilter, function(err, isOlder) {
                if (err) {
                    clearGeneration(err);
                    next(err);
                    return;
                }
                if (isOlder) {
                    logger && logger("Too old, regenerating.", "debug");
                    generateAndServe(null, sources, next);
                } else {
                    if (serve) {
                        logger && logger('Serve existing file.', "debug");
                        serveResource(null, destpath, res, next);
                    } else {
                        next();
                    }
                    clearGeneration();
                }
            });
        }

        function getSources(next) {
            logger && logger("Getting sources", "debug");
            if (typeof src === 'function') {
                src(destpath, resolveAndRemoveDestination);
            } else {
                resolveAndRemoveDestination(null, src);
            }
            function resolveAndRemoveDestination(err, sources) {
                if (err) {
                    next(err);
                    return;
                }

                next(null, sources.map(function(s) { return path.resolve(s); }).filter(function(s) {
                    if (s === destpath) {
                        logger && logger('Destination was removed from source list', 'warn');
                        return false;
                    }
                    return true;
                }));
            }
        }

        function generateAndServe(err, sources) {
            if (err) {
                clearGeneration(err);
                next(err);
                return;
            }
            generateResource(sources, destpath, function(err, fromPath) {
                if (err) {
                    next(err);
                    return;
                }
                if (serve) {
                    serveResource(err, fromPath, res, next);
                } else {
                    next();
                }
                clearGeneration(err);
            });
        }
    }

    function generateResource(sources, destpath, next) {
        logger && logger("Generating output file", "debug");

        var writeStream;
        var anySources;

        reduceSeed(destpath, handleReduceSeed);

        function handleReduceSeed(err, ws) {
            writeStream = ws;

            if (err) {
                next(err);
                return;
            }

            handleSrcs(sources);
        }

        function handleSrcs(sourcePaths) {
            logger && logger('Source directories/files: ' + sourcePaths, "debug");

            var file;
            var readStream;

            var iterator = subpathIterator(sourcePaths);
            iterator(handleNext);


            function handleNext(err, fp, s) {

                if (err) {
                    finalize(err);
                    return;
                }

                if (fp == null) { // iteration complete
                    finalize();
                    return;
                }

                if (path.resolve(fp) === path.resolve(destpath)) {
                    logger && logger('Ignored output path as an input file', "info");
                    iterator(handleNext);
                    return;
                }

                file = { path : fp, stat : s, extname : path.extname(fp) };

                logger && logger('Beginning transformation pipeline for ' + file.path, "debug");

                logger && logger('Prefilter checking: ' + file.path, "debug");
                prefilter(file, handlePrefilter);
            }

            function handlePrefilter(err, include) {
                if (err) {
                    finalize(err);
                    return;
                }
                if (!include) {
                    logger && logger('Prefiltered: ' + file.path, "debug");
                    iterator(handleNext);
                    return;
                }
                logger && logger('Mapping: ' + file.path, "debug");
                map(file, handleMap);
            }

            function handleMap(err, rs) {
                readStream = rs;
                file.mapped = rs;

                if (err) {
                    finalize(err);
                    return;
                }

                logger && logger('Filter checking: ' + file.path, "debug");
                filter(file, handleFilter);
            }

            function handleFilter(err, include) {
                if (err) {
                    finalize(err);
                    return;
                }
                if (!include) {
                    logger && logger('Filtered: ' + file.path);
                    iterator(handleNext);
                    return;
                }
                reduce(writeStream, file, handleReduce);
            }

            function handleReduce(err, ws) {
                if (err) {
                    finalize(err);
                    return;
                }

                anySources = true;
                
                logger && logger('Included: ' + file.path);

                writeStream = ws || writeStream;

                iterator(handleNext);
            }
        }

        function finalize(err) {
            logger && logger('Finished with files', "debug");

            if (err) {
                // don't wait for writeStream to close on an error
                // just gtfo
                writeStream && writeStream.end && writeStream.end();
                next(err);
                return;
            }

            logger && logger('Calling postReduce', "debug");
            postReduce(writeStream, function(err) {
                next(err, anySources && destpath);
            });
        }
    }

    function serveResource(err, fromPath, res, next) {
        logger && logger('Serving ' + fromPath, "debug");
        if (err) {
            next(err);
            return;
        }

        if (!fromPath) {
            // nothing to serve
            next();
            return;
        }

        createReadStream(encoding)({ path : fromPath }, function(err, readStream) {
            if (err) {
                next(err);
                return;
            }
            readStream.once('error', next);
            readStream.pipe(res);
        });
    }

    return middleware;
}

module.exports = assets;