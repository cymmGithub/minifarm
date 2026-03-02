const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const app = express();

const routes = require('./routes.js');
const pipelineRoutes = require('./pipeline-routes.js');

// Initialize pipeline executor (listens for run:started events)
require('./pipeline-executor.js');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());

// API routes (must come before static files)
app.get('/api/reports', routes.api_reports);
app.get('/api/test-filter', routes.api_test_filter_get);
app.post('/api/test-filter', routes.api_test_filter_set);

app.get('/clients', routes.clients);
app.get('/api/clients-status', routes.api_clients_status);
app.get('/test', routes.test);
app.get('/results', routes.results);
app.get('/queue', routes.queue);
app.get('/status', routes.status);
app.post('/cancel', routes.cancel);
app.post('/purge-old', routes.purge_old);
app.post('/delete-reports', routes.delete_reports);
app.post('/rerun-test', routes.rerun_test);

// Pipeline routes
app.post('/pipeline/validate-branch', pipelineRoutes.validateBranch);
app.post('/pipeline/start', pipelineRoutes.startPipeline);
app.post('/pipeline/cancel/:runId', pipelineRoutes.cancelPipeline);
app.get('/pipeline/state', pipelineRoutes.getPipelineState);
app.get('/pipeline/history', pipelineRoutes.getPipelineHistory);
app.get('/pipeline/stream', pipelineRoutes.pipelineStream);

// SSE endpoint for real-time queue updates
app.get('/queue/stream', (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	// Send initial state
	res.write(`data: ${JSON.stringify(routes.getEnrichedQueue())}\n\n`);

	// Listen for updates
	const handler = (data) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};
	routes.queueEvents.on('queue-update', handler);

	req.on('close', () => {
		routes.queueEvents.off('queue-update', handler);
	});
});

// SSE endpoint for real-time reports updates
app.get('/reports/stream', async (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	// Send initial state
	const initialReports = await routes.getReportsList();
	res.write(`data: ${JSON.stringify(initialReports)}\n\n`);

	// Listen for updates
	const handler = (data) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};
	routes.reportEvents.on('reports-update', handler);

	req.on('close', () => {
		routes.reportEvents.off('reports-update', handler);
	});
});

// Serve Playwright HTML reports statically
app.use('/reports', express.static(process.env.PATH_TO_REPORTS, {
	index: false,
}));

// Serve React dashboard at root
app.use(express.static(path.join(__dirname, 'dashboard/dist')));

// SPA fallback - serve index.html for any unmatched routes
app.get('*', (req, res) => {
	res.sendFile(path.join(__dirname, 'dashboard/dist/index.html'));
});

module.exports = app;
