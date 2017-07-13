/**
 * @file Homekit Accessory Server Core Class
 * @author MohammadHossein Abedinpour <abedinpourmh@gmail.com>
 * @licence Apache2
 */

import Config from './config';
import * as HTTP from 'http';
import expressApp from './express';
import * as express from 'express';
import TCP from './TCP';
import Accessory from './accessory';
import {statusCodes} from './TLV/values';
const Bonjour = require('bonjour');

//HAP is using HTTP in it's own way. To meet its requirements and also not rewriting the whole HTTP module, We will create a TCP server which iOS will connect to it and we will do HAP stuffs in this layer.
//We also will create an HTTP server which will process the iOS requests and generate response for them.
//We also will use an internal TCP socket pool to proxy iOS requests to HTTP and also HTTP responses to iOS.

export default class HAS {

    /**
     * @property HAS Config Helper
     * @public
     * @requires
     */
    public config: Config;

    /**
     * @property Bonjour Helper
     * @public
     * @requires
     */
    public bonjour: any;

    /**
     * @property Bonjour Service
     * @private
     */
    private bonjourService: any;

    /**
     * @property Express App
     * @private
     */
    private expressApp: express.Express;

    /**
     * @property TCP Server
     * @public
     */
    public TCPServer: TCP;

    /**
     * @property HTTP Server
     * @private
     */
    private HTTPServer: HTTP.Server;

    /**
     * @property List of accessories of this server
     * @private
     */
    private accessories: { [index: number]: Accessory } = {};

    /**
     * @property Whether or not this server is up
     * @private
     */
    private isRunning: boolean = false;

    /**
     * @property Identify handler for this characteristic
     * @public
     */
    public onIdentify: (value: any, callback: (status: statusCodes) => void) => void;

    /**
     * @method Creates new instance of class
     * @param config - Instance of configuration helper
     */
    constructor(config: Config) {
        this.bonjour = Bonjour();

        if (config)
            this.config = config;
        else
            throw  new Error('Invalid HAS Config');

        this.config.setServer(this);

        this.expressApp = expressApp(this);
        this.HTTPServer = HTTP.createServer(this.expressApp);

        this.TCPServer = new TCP(this);
    }

    /**
     * @method Starts HTTP and Bonjour
     */
    public startServer() {
        if (Object.keys(this.accessories).length <= 0)
            throw new Error('Server must have at least one accessory.');

        this.config.increaseCCN(false);

        this.updateBonjour();

        this.HTTPServer.timeout = 0; //TCP connection should stay open as lang as it wants to
        this.HTTPServer.listen(0);
        this.HTTPServer.on('listening', () => {
            console.log(`HTTP Server Listening on ${this.HTTPServer.address().port}`);
        });

        this.TCPServer.listen(this.config.TCPPort, this.HTTPServer.address().port);
        this.TCPServer.on('listening', () => {
            console.log(`TCP Server Listening on ${this.config.TCPPort}`);
        });

        this.isRunning = true;
    }

    /**
     * @method Stops HTTP, TCP and Bonjour
     */
    public stopServer() {
        if (this.bonjourService)
            this.bonjourService.stop();
        if (this.HTTPServer)
            this.HTTPServer.close();
        if (this.TCPServer)
            this.TCPServer.close();

        this.isRunning = false;
    }

    /**
     * @method Publishes Bonjour service
     */
    public updateBonjour() {
        if (!this.bonjourService) {
            //Publish new service
            this.bonjourService = this.bonjour.publish({
                name: this.config.deviceName,
                type: 'hap',
                port: this.config.TCPPort,
                txt: this.config.getTXTRecords(),
            });
            this.bonjourService.on('up', () => {
                console.log('Bonjour is up');
            });
        } else {
            //Update existing server TXT records
            this.bonjourService.txt = this.config.getTXTRecords();
            this.bonjour._server.unregister(this.bonjourService._records());
            this.bonjour._server.register(this.bonjourService._records());
        }
    }

    /**
     * @method Adds an accessory to this server
     * @param accessory
     */
    public addAccessory(accessory: Accessory) {
        let accessoryID = accessory.getID();

        if (accessoryID < 1 || accessoryID > 999)
            throw new Error('Accessory ID can not be less than 1 or more than 999: ' + accessoryID);

        if (Object.keys(this.accessories).length >= 100)
            throw new Error('Server can not have more than 100 accessories: ' + accessoryID);

        if (Object.keys(accessory.getServices()).length <= 0)
            throw new Error('Accessory must contain at least one service: ' + accessoryID);

        if (!accessory.getServices()[1])
            throw new Error('Accessory must contain information service: ' + accessoryID);

        if (this.accessories[accessoryID])
            throw new Error('Accessory ID already exists: ' + accessoryID);

        this.accessories[accessoryID] = accessory;
        accessory.setServer(this);

        if (this.isRunning)
            this.config.increaseCCN();
    }

    /**
     * @method Removes an accessory from this server
     * @param accessoryID
     */
    public removeAccessory(accessoryID: number) {
        if (!this.accessories[accessoryID])
            throw new Error('Accessory ID does not exists: ' + accessoryID);

        delete this.accessories[accessoryID];

        if (this.isRunning)
            this.config.increaseCCN();
    }

    /**
     * @method Returns list of accessories
     * @returns {{[p: number]: Accessory}}
     */
    public getAccessories(): { [index: number]: Accessory } {
        return this.accessories;
    }
}