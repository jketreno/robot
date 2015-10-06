NOTE: These scripts require root, or you need to configure udev to create
GPIO entries with non-root group priviledge and add the user to that group.

button - Watches GPIO pin 483. If value is 1, begin blinking IP.
blinkip - Determines IP address and blinks the led for each ASCII character.
led - Turns up to three LEDs off and on (via GPIO pins 338, 339, and 340)

led usage: led 1|0 [1|0 [1|0]]

Sets each GPIO pin either off or on based on provided value.
