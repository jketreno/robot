/*
 * Copyright (c) 2015, Intel Corporation.
 *
 * This program is licensed under the terms and conditions of the 
 * Apache License, version 2.0.  The full text of the Apache License is at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
*/
var cv = require('opencv'),
    io = require('socket.io')({
        path: '/' + require('path').basename(__dirname) + '/socket.io'
    }).listen(6789);
var cam = new cv.VideoCapture(0),
    socket = null;
cam.setWidth(160);
cam.setHeight(120);

function detectFaces(err, im) {
    im.detectObject(cv.FACE_CASCADE, {}, function (err, faces) {
        io.emit('frame', {
            image: im.toBuffer({ext:'.png'}),
            size: { width: 160, height: 120 },
            faces: faces
        });
        cam.read(detectFaces);
    });
}

cam.read(detectFaces);