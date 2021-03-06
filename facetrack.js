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
    }).listen(6789),
    ir = require('irobot'),
    fs = require('fs'),
    mraa = require('mraa');

var width = 320,
    height = 240;

var cam = new cv.VideoCapture(0);
cam.setWidth(width);
cam.setHeight(height);

var led = null;
try {
	led = new mraa.Gpio(23);
	led.dir(mraa.DIR_OUT);
} catch (err) {
	console.log('Unable to connect to GPIO. Do you have permissions?');
}

var sockets = [];

var FOV = 68.5, /* Microsoft HD LiveCam is 68.5deg diagonal FOV */
    FOV_x = FOV * Math.cos (Math.atan2(height, width)) * 0.5; /* FOV along width */

var moving = { left: 0, right: 0 },
    lastCommand = 0,
    noFace = 0,
    currentFPS = 0;

var updateFPS = (function() {
    var fpsRA = [0, 0, 0, 0, 0],
        fpsTotal = 0,
        fpsIndex = 0,
        fpsLast = Date.now();

    return function() {
        var now = Date.now();
        fpsTotal -= fpsRA[fpsIndex];
        fpsRA[fpsIndex] = (now - fpsLast) / fpsRA.length;
        fpsTotal += fpsRA[fpsIndex++];
        fpsIndex %= fpsRA.length;
        fpsLast = now;
        return 1000 / fpsTotal;
    }
})();

/* Increase this to make the robot move faster */
var speedMultiplier = 5;

function detectFacesAndTrack(err, image) {
    image.detectObject(cv.FACE_CASCADE, {}, function (err, faces) {
        if (err) {
            throw err;
        }
        var largest = -1;

        currentFPS = updateFPS();
        
        faces.forEach(function (face, i) {
            faces[i].size = face.width * face.height;

            if (largest == -1 || faces[i].size > faces[largest].size) {
                largest = i;
            }
        });
        
        updatePlan({face: largest == -1 ? null : faces[largest]});

        if (largest != -1) {
            faces[largest].largest = true;
        }
        
        io.emit('frame', {
            image: image.toBuffer({ext:'.png'}),
            size: { width: image.width(), height: image.height() },
            faces: faces
        });
        
        cam.read(detectFacesAndTrack);
    });
}

function requestLED(state) {
    if (led) {
        led.write(state ? 0 : 1);
    }
}

var requestSpeed = (function() {
    var timer = 0;
    
    return function(left, right, duration) {
        if (!robot || !robot.ready) {
            return;
        }

        if (timer) {
            clearTimeout(timer);
        }

        if (duration) {
            timer = setTimeout(function() {
                console.log('Drive timeout; stopping motors.');
                robot.drive({left: 0, right: 0});
            }, duration);
        } else {
            timer = 0;
        }
        
        /* Validate requested speeds make sense given current sensor wall and
        * cliff values, adjust accordingly */

        /* Send the new speed values to the robot */
        robot.drive({left: Math.round(left), right: Math.round(right)});
    }
})();

function updatePlan(update) {
    if ('face' in update) { /* face update */
        var now = Date.now();
        if (!update.face) {
            if (++noFace == 5) {
                console.log('No faces for ' + noFace + ' frames. Stopping robot.');
                requestSpeed(0, 0); /* TODO: Switch into SEEK mode */
                requestLED(0); /* Turn OFF 'face detected' LED */
            }
            return;
        }

        /* We detected a face, so keep moving for at least 5 sequential frames... */
        noFace = 0;
        
        requestLED(1); /* Turn ON 'face detected' LED */
 
        /* calculate how far 'face' is from center of image and determeine 
         * optimal motor speeds to move robot in direction to center face */
        var face = update.face;
        var deltaAngle = FOV_x * ((face.x + face.width / 2) / (width / 2) - 1),
            framePos = (face.y + face.height / 2) / ((height - face.height) / 2) - 1,
            rotateSpeed = Math.pow(deltaAngle / FOV_x, 2);
        var left = 0, right = 0;
        
        /* Calculate the distance each wheel should travel in order to rotate the Roomba
         * half the angle over the course of the next second.
         *
         * 9.25" from wheel center to wheel center on the Roomba gives a 4.625" radius, 
         * which is 117.475mm */
        var radius = 117.475,
            circumference = 2 * Math.PI * radius,
            distance = circumference * deltaAngle / 360;
        
        /* TODO: Scale speed for 1s and then set a timer to stop the speed if it hasn't
         * been reset */
        console.log('Tire speed (' + (Math.round(deltaAngle * 10) / 10) + 'deg): ' + 
                    Math.round(distance * 5) / 10);
        
        left = distance * 0.5;
        right = -left;
        
        /* Move forward or backward if necessary to center the face in the frame
         * vertically */
        if (Math.abs(framePos) < 1 && Math.abs(framePos) > 0.15) {
            var direction = framePos < 0 ? -1 : +1;
            left += direction * 40;
            right += direction * 40;
            console.log('Drive ' + (direction < 0 ? 'backward' : 'forward'));
        } 

        requestSpeed(left * speedMultiplier, right * speedMultiplier, 1000);
    } else if ('sensors' in update) {
    }
}

var robot;
try {
    var stats = fs.statSync('/dev/ttyUSB0');
    /* The documentation states a baud rate of 57600, however using a logic 
     * analyzer, I found that communication was occurring at 115200 baud */
    robot = new ir.Robot('/dev/ttyUSB0', {
        baudrate: 115200
    });

    robot.on('ready', function () {
        console.log('READY');
        robot.ready = true;
        lastCommand = Date.now();
     });
    
    robot.on('sensordata', function() {
        var data = robot.getSensorData();
        updatePlan({sensors: data});
        if (Object.getOwnPropertyNames(data).length > 0) {
            io.emit('sensordata', robot.getSensorData());
        }
    });
} catch (err) {
    console.log('No robot found at /dev/ttyUSB0. Continuing without robot.');
    robot = null;
}

io.on('connection', function(_socket) {
    sockets.push(_socket);
    console.log('CONNECT');

    _socket.on('disconnect', function() {
        console.log('DISCONNECT');
        /* Remove this socket from the list of active sockets */
        sockets = sockets.filter(function(socket) {
            return (_socket != socket);
        });
        console.log(sockets.length + ' connections remain.');
    });
    
    /* If we have a robot connection, send the sensor data
     * to the new socket */
    if (robot && robot.ready) {
       var data = robot.getSensorData();
       if (Object.getOwnPropertyNames(data).length > 0) {
           _socket.emit('sensordata', robot.getSensorData());
       }
    }
});

cam.read(detectFacesAndTrack);
