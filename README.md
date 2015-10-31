Sample source files used in the Robot Developer Journey 
(https://01.org/developerjourney)

To install:

```
git clone https://github.com/jketreno/robot.git
```

facetrack.js requires the Node.js OpenCV module, which in turn requries 
several OpenCV packages to be installed on your system:

```
apt-get install libopencv-dev libopencv-{core,calib3d,contrib,legacy}2.4
```

Once you have OpenCV installed, you can install the depenceny Node.js 
modules:

```
npm install --save opencv
npm install --save irobot
npm install --save socket.io
npm install --save mraa
```

To use:

```
node facetrack.js
```
