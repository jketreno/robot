/*
 * Copyright (c) 2015, Intel Corporation.
 *
 * This program is licensed under the terms and conditions of the 
 * Apache License, version 2.0.  The full text of the Apache License is at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
*/
var cv = require('opencv'),
    io = require('socket.io')({path: "/roomba/facetrack/socket.io"}).listen(6789),
    ir = require('irobot'),
    mraa = require('mraa');

var cam = new cv.VideoCapture(0);
cam.setWidth(320);
cam.setHeight(240);

var led = null;
try {
	led = new mraa.Gpio(23);
	led.dir(mraa.DIR_OUT);
} catch (err) {
	console.log('Unable to connect to GPIO. Do you have permissions?');
}

var sockets = [];

var FOV = 68.5, /* Microsoft HD LiveCam is 68.5deg diagonal FOV */
    FOV_x = FOV * Math.cos (Math.atan2(240, 320)) * 0.5; /* FOV along width */

var moving = { left: 0, right: 0 },
    lastCommand = 0,
    noFace = 0;

/* Increase this to make the robot move faster */
var speedMultiplier = 5;

function detectFacesAndTrack(err, image) {
    var faces = [];
    image.detectObject(cv.FACE_CASCADE, {}, function (err, faces) {
        if (err) {
            throw err;
        }
        var largest = null;
        
        faces.forEach(function (face) {
            face.size = face.width * face.height;
            if (!largest || face.size > largest.size) {
                largest = face;
            }
        });
        
        updatePlan({face: largest});
        
        io.emit('frame', {
            faces: faces,
            image: im.toBuffer({ext:'.png'})
        });

        cam.read(detectFacesAndTrack);
    });
}

function requestLED(state) {
    if (led) {
        led.write(state ? 0 : 1);
    }
}

function requestSpeed(left, right) {
   /* Validate requested speeds make sense given current sensor wall and
    * cliff values, adjust accordingly */

   /* Send the new speed values to the robot */
   robot.drive({left: left, right: right});
}

function updatePlan(update) {
    if ('face' in update) { /* face update */
        var now = Date.now();
        if (!update.face) {
            requestSpeed(0, 0); /* TODO: Switch into SEEK mode */
            requestLED(0); /* Turn OFF 'face detected' LED */
            return;
        }

        requestLED(1); /* Turn ON 'face detected' LED */

        /* calculate how far 'face' is from center of image and determeine 
         * optimal motor speeds to move robot in direction to center face */
        if (robot && robot.ready) {
            var deltaAngle = FOV_x * ((largest.x + largest.width / 2) / (320 / 2) - 1),
                framePos = (largest.y + largest.height / 2) / ((240 - largest.height) / 2) - 1;
            if (now - lastCommand > 250 && robot) {
                var rotateSpeed = Math.pow(deltaAngle / FOV_x, 2);
                if (deltaAngle < 0) {
                    console.log('Rotate left ' + Math.round(deltaAngle * 10) / 10 + 'deg');
                    moving.left = 100 * rotateSpeed;
                    moving.right = -100 * rotateSpeed;
                } else {
                    console.log('Rotate right ' + Math.round(deltaAngle * 10) / 10 + 'deg');
                    moving.left = -100 * rotateSpeed;
                    moving.right = 100 * rotateSpeed;
                }
                console.log(framePos);
                if (Math.abs(framePos) < 1 && Math.abs(framePos) > 0.15) {
                    var direction = framePos < 0 ? -1 : +1;
                    moving.left += direction * 40;
                    moving.right += direction * 40;
                    console.log('Drive ' + (direction < 0 ? 'backward' : 'forward'));
                } else {
                    console.log('Just rotate at ' + Math.round(100 * rotateSpeed));
                }

                moving.left = Math.round(moving.left * speedMultiplier);
                moving.right = Math.round(moving.right * speedMultiplier);
                requestSpeed(moving.left, moving.right);
                lastCommand = now;
            }
            
            /* We detected a face, so keep moving for at least 5 sequential frames... */
            noFace = 0;
        } else {
            if ((moving.left || moving.right) && noFace++ > 3) {
                noFace = 0;
                moving.left = moving.right = null;
                console.log('Faces for ' + noFace + ' frames. Stopping robot.');
                if (robot && robot.ready) {
                    robot.drive({
                        left: 0,
                        right: 0
                    });
                }
            } 
        }
    } else if ('sensors' in update) {
    }

}

/* The documentation states a baud rate of 57600, however using a logic 
 * analyzer, I found that communication was occurring at 115200 baud */
robot = new ir.Robot('/dev/ttyUSB0', {
   baudrate: 115200
});

robot.on('ready', function () {
    console.log('READY');
    robot.ready = true;
    lastCommand = Date.now();
    // Once the robot is ready, start face detection tracking
    cam.read(detectFacesAndTrack);
 });
robot.on('sensordata', function() {
    var data = robot.getSensorData();
    updatePlan({sensors: data});
    if (Object.getOwnPropertyNames(data).length > 0) {
        io.emit('sensordata', robot.getSensorData());
    }
});

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
    if (robot) {
       var data = robot.getSensorData();
       if (Object.getOwnPropertyNames(data).length > 0) {
           _socket.emit('sensordata', robot.getSensorData());
       }
    }
});
