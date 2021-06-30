// Import Required Modules
const sharp = require('sharp');

// Export Class Function
module.exports = function (RED) {
    RED.nodes.registerType("camera-motion", function (config) {
        // Create the node in node red
        RED.nodes.createNode(this, config);

        // Node Variables
        node = this;
        node._busy = false;

        // Input Variables
        node._payload = null;
        node._input = null;
        node.input_width = parseInt(config.input_width, 10) || 250;
        node.blur = parseFloat(config.blur) || 1.0;

        // Motion Variables
        node._cmp = null;
        node._motion = false;
        node.output_image = config.output_image || false;
        node.threshold_cutoff = parseInt(config.threshold_cutoff, 10) || 25;
        node.motion_percentage = parseFloat(config.motion_percentage) || 10.0;

        // Background Variables
        node._bg = [];
        node.background_capture_frames = parseInt(config.background_capture_frames, 10) || 5;

        // Input Conditioning Functions
        node.is_busy = function () {
            return node._busy;
        }
        node.is_buffer = async function (payload) {
            try {
                if (Buffer.isBuffer(payload)) {
                    node._busy = true;
                    return payload;
                } else {
                    throw "Payload was not a buffer";
                };
            }
            catch (err) {
                throw err;
            }
        }
        node.condition_input = async function (payload) {
            try {
                node._payload = payload;
                node._input = await sharp(payload)
                    .resize({ width: node.input_width })
                    .greyscale()
                    .blur(node.blur);
                return {};
            }
            catch (err) {
                throw err;
            }
        }

        // Background Image Functions
        node.grab_bg = async function (msg) {
            try {
                if (node._bg.length - 1 > node.background_capture_frames) node._bg.shift();
                node._bg.push(await node._input.toBuffer())
                return msg;
            }
            catch (err) {
                throw err;
            }
        }

        // Motion Functions 
        node.compare_to_background = async function (msg) {
            try {
                if (node._bg.length) {
                    await node._input
                        .composite([{ input: node._bg[0], blend: 'difference' }])
                        .raw()
                        .toBuffer({ resolveWithObject: true })
                        .then(async function ({ data, info }) {
                            try {
                                node._cmp = data;
                                msg["info"] = info
                            } catch (err) {
                                throw err;
                            }
                        })
                }
                return msg;
            }
            catch (err) {
                throw err;
            }
        }
        node.calculate_motion = async function (msg) {
            // Calculate the motion value
            const reducer = (acc, val) => { return (val > node.threshold_cutoff) ? acc + 1 : acc; };
            msg["motion_value"] = node._cmp.reduce(reducer);
            msg.motion_value = Math.round(msg.motion_value / node._cmp.length * 10000) / 100;
            msg.motion = (msg.motion_value > node.motion_percentage);

            // // Create the motion image if required
            // if (node.output_image) {
            //     const { width, height, channels } = msg.info;
            //     const mapper = (value) => { return (value > node.threshold_cutoff) ? 255 : 0 }
            //     let threshold_img = new Uint8Array(node._cmp.map(mapper));

            //     await sharp(threshold_img, { raw: { width, height, channels } })
            //         .jpeg()
            //         .toBuffer()
            //         .then((data) => {
            //             msg["motion_img"] = data;
            //         })
            // }

            // Output Image
            if (node.output_image) msg["motion_frame"] = node._payload;

            // Return Message
            return msg;
        }

        // Output Conditioning Functions
        node.send_message = async function (send, msg) {
            try {
                delete msg.info;
                if (msg.motion != node._motion) {
                    node._motion = msg.motion;
                    send(msg);
                }
            } catch (err) {
                throw err;
            }
        }
        node.show_error = async function (err) {
            RED.log.error(err);
        }
        node.set_not_busy = async function () {
            node._busy = false;
        }

        // Node Events
        node.on('input', function (msg, send, done) {
            node.start_time = Date.now();

            if (!node.is_busy())
                node.is_buffer(msg.payload)
                    .then(node.condition_input)
                    .then(node.grab_bg)
                    .then(node.compare_to_background)
                    .then(node.calculate_motion)
                    .then(node.send_message.bind(this, send))
                    .then(node.set_not_busy)
                    .catch(node.show_error)
                    .then(node.set_not_busy)
                    .finally(done)
        });
    });
}