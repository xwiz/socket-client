const { SSLApp } = require("uWebSockets.js");
const fs = require("fs");
const url = require("url");
const { DEDICATED_DECOMPRESSOR_4KB } = require("uWebSockets.js");
const decoder = new TextDecoder();
var certFile = "/ssl/fullchain.pem";
var keyFile = "/ssl/privkey.pem";
let preventDoubleAuthentication = true;
const userSockets = new Map();
const akkadGame = new akkadGame();

const redisClient = redis.createClient({
    host: "host",
    port: 6379,
});

const redisGet = promisify(redisClient.get).bind(redisClient);
const redisSet = promisify(redisClient.set).bind(redisClient);
const redisDel = promisify(redisClient.del).bind(redisClient);

const app = SSLApp({
    key_file_name: keyFile,
    cert_file_name: certFile,
})
    .post("/master", (res, req) => {
        /* Note that you cannot read from req after returning from here */
        let url = req.getUrl();

        /* Read the body until done or error */
        readJson(
            res,
            (obj) => {
                console.log("API DATA", obj);
                if (obj.master_key === "SOME_KEY") {
                    hintMessage = obj;
                    res.cork(() => {
                        res.end("msg received from api!" + obj.target);
                    });
                    publishToChannel(target, obj.data);
                } else {
                    res.cork(() => {
                        res.end("Invalid data");
                    });
                }
            },
            () => {
                /* Request was prematurely aborted or invalid or missing, stop reading */
                console.log("Invalid JSON or no data at all!");
            }
        );
    })
    .ws("/*", {
        idleTimeout: 300,
        maxBackpressure: 2048,
        maxPayloadLength: 512,
        sendPingsAutomatically: true,
        compression: DEDICATED_DECOMPRESSOR_4KB,
        upgrade: (res, req, context) => {
            /* Keep track of abortions */
            const upgradeAborted = { aborted: false };
            res.onAborted(() => {
                /* We can simply signal that we were aborted */
                upgradeAborted.aborted = true;
            });
            let ticket = req.getQuery("ticket");
            //if necessary
            let domain = req.getQuery("domain");
            //const url = req.getUrl();
            const secWebSocketKey = req.getHeader("sec-websocket-key");
            const secWebSocketProtocol = req.getHeader(
                "sec-websocket-protocol"
            );
            const secWebSocketExtensions = req.getHeader(
                "sec-websocket-extensions"
            );

            if (ticket) {
                redisGet(ticket)
                    .then((data) => {
                        if (!data || !isNumeric(data)) {
                            console.log("Bad Authentication: " + ticket);
                            if (!upgradeAborted.aborted) {
                                res.cork(() => {
                                    res.end("Token not found or invalid", true);
                                });
                            }
                        } else {
                            // Check if user already connected
                            return redisGet("A_" + data).then(
                                (existingData) => {
                                    if (
                                        existingData &&
                                        preventDoubleAuthentication
                                    ) {
                                        console.log(
                                            "User " +
                                                ticket +
                                                " already authenticated via: " +
                                                existingData
                                        );
                                        if (!upgradeAborted.aborted) {
                                            res.upgrade(
                                                {
                                                    ticket: ticket,
                                                    domain: domain,
                                                    duplicate: true,
                                                    userId: data,
                                                },
                                                secWebSocketKey,
                                                secWebSocketProtocol,
                                                secWebSocketExtensions,
                                                context
                                            );
                                        }
                                    } else {
                                        console.log(
                                            "Authentication OK: " + ticket
                                        );
                                        if (!upgradeAborted.aborted) {
                                            res.upgrade(
                                                {
                                                    ticket: ticket,
                                                    domain: domain,
                                                    duplicate: false,
                                                    userId: data,
                                                },
                                                secWebSocketKey,
                                                secWebSocketProtocol,
                                                secWebSocketExtensions,
                                                context
                                            );
                                        }

                                        // Set authentication data in Redis
                                        return redisSet(
                                            "A_" + data,
                                            ticket,
                                            "EX",
                                            84000
                                        );
                                    }
                                }
                            );
                        }
                    })
                    .catch((err) => {
                        console.error("Error during authentication:", err);
                        if (!upgradeAborted.aborted) {
                            res.cork(() => {
                                res.end(
                                    "Could not complete authentication",
                                    true
                                );
                            });
                        }
                    });
            } else {
                console.log("User cannot authenticate");
                res.cork(() => {
                    res.end("Token not found", true);
                });
            }
        },
        open: (socket) => {
            //const tkn = socket.ticket;//
            //increase security by appending user ticket to channel
            if (socket.duplicate && preventDoubleAuthentication) {
                console.log(
                    "Closing all other subscribers for: " + socket.userId
                );

                if (userSockets.has(socket.userId)) {
                    const existingSocket = userSockets.get(socket.userId);
                    existingSocket.close(); // Close the existing socket connection
                }

                // Store the current socket connection
                userSockets.set(socket.userId, socket);
            }
            //
            //subscribe to domain messages by default
            socket.subscribe(socket.domain);
        },
        message: (socket, message, isBinary) => {
            // comment out if needed
            // if (socket.duplicate && preventDoubleAuthentication) {
            //   console.log("Ignoring duplicate subscriber: " + socket.ticket);
            //   return;
            // }
            try {
                const messageString = decoder.decode(message);
                const data = JSON.parse(messageString);
                console.log("Received data: " + messageString);

                //push message to intended target
                if (data.event === "join") {
                    // join akkad etc
                    socket.subscribe(data.channel);
                }
                if (data.event === "cashOut") {
                    // akkad cash out etc
                }
            } catch (e) {
                console.log(`Received invalid data, Error: ` + e.message);
            }
        },
        close: (socket, code, message) => {
            userSockets.delete(socket.userId);
            redisDel(socket.ticket, (err) => {
                if (err) {
                    console.log("User logout failed");
                } else {
                    redisDel("A_" + socket.userId, (err) => {
                        if (err) {
                            console.log("User logout incomplete");
                        } else {
                            console.log(
                                "User " +
                                    socket.userId +
                                    " disconnected :" +
                                    socket.ticket
                            );
                        }
                    });
                }
            });
        },
    })
    .listen(9081, "0.0.0.0", (ticket) => {
        if (ticket) {
            console.log("Listening on port 7070");
            //imaginary method to receive the publisher
            akkadGame.launch(new MessageEmitter(app));
        } else {
            console.log("Failed to listen");
        }
    });

/* Helper function for reading a posted JSON body */
function readJson(res, cb, err) {
    let buffer;
    /* Register data cb */
    res.onData((ab, isLast) => {
        let chunk = Buffer.from(ab);
        if (isLast) {
            let json;
            if (buffer) {
                try {
                    json = JSON.parse(Buffer.concat([buffer, chunk]));
                } catch (e) {
                    /* res.close calls onAborted */
                    res.close();
                    return;
                }
                cb(json);
            } else {
                try {
                    json = JSON.parse(chunk);
                } catch (e) {
                    /* res.close calls onAborted */
                    res.close();
                    return;
                }
                cb(json);
            }
        } else {
            if (buffer) {
                buffer = Buffer.concat([buffer, chunk]);
            } else {
                buffer = Buffer.concat([chunk]);
            }
        }
    });

    /* Register error cb */
    res.onAborted(err);
}

//sample function to publish message to a channel
function publishToChannel(channel, message) {
    if (message != null) {
        //comment this out in production
        console.log("Publishing to " + app.numSubscribers(channel));
        app.publish(channel, JSON.stringify(message), false);
    }
}

function isNumeric(str) {
    if (typeof str != "string") return false; // we only process strings!
    return !isNaN(str) && !isNaN(parseInt(str)); // ...ensure strings of whitespace fail
}
class MessageEmitter {
    constructor(appInstance) {
        this.app = appInstance;
        this.channel = null;
    }

    to(channel) {
        this.channel = channel;
        return this;
    }

    emit(message) {
        if (this.channel && message != null) {
            console.log(
                `Publishing to ${this.channel}: ${this.app.numSubscribers(
                    this.channel
                )}`
            );
            this.app.publish(this.channel, JSON.stringify(message), false);
        }
        return this;
    }
}
