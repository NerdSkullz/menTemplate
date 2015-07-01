"use strict";

var fs = require('fs');
var path = require('path');


function getSubpathIterator(paths) {
    paths = paths.slice();
    var calling = false;
    return function callWithNextPath(next) {
        if (calling) {
            throw new Error('Cannot call iterator again until your first path is returned.');
        }
        calling = true;
        if (!paths.length) {
            calling = false;
            next();
            return;
        }

        var filepath = paths.shift();
        fs.stat(filepath, function(err, stat) {
            if (err) {
                calling = false;
                next(err);
                return;
            }
            if (stat.isFile()) {
                calling = false;
                next(null, filepath, stat);
                return;
            }

            if (stat.isDirectory()) {
                fs.readdir(filepath, function(err, files) {
                    if (err) {
                        calling = false;
                        next(err);
                        return null;
                    }
                    paths = files.map(function(file) {
                        return path.join(filepath, file);
                    }).concat(paths);
                    calling = false;
                    callWithNextPath(next);
                });
                return;
            }
            calling = false;
            next(new Error("Path was neither file or directory?"));
        });
    };
}

module.exports = getSubpathIterator;