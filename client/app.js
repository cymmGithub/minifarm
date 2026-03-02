const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const logger = require('morgan');
const app = express();

const routes = require('./routes.js');

// Client registration is now static via clients.json on the server
// Self-registration was removed to avoid conflicts with overlay network IPs

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.get('/ping', routes.ping);
app.get('/run-test', routes.run_test);
app.post('/update-tests', routes.update_tests);
app.post('/purge-leftovers', routes.purge_leftovers);

module.exports = app;
