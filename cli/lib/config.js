import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths - auto-detect based on SCRIPT_DIR
export const SCRIPT_DIR = path.resolve(__dirname, '..');
export const CODE_DIR = path.resolve(SCRIPT_DIR, '../..');
export const DEVOPS_DIR = process.env.MINIFARM_DEVOPS_DIR || path.join(CODE_DIR, 'devops');
export const DEPLOY_DIR = path.join(DEVOPS_DIR, 'deploy');
export const APPS_DIR = process.env.MINIFARM_APPS_DIR || path.join(DEVOPS_DIR, 'apps');

// Network configuration
export const REGISTRY_URL = '10.0.1.1:5000';
export const MASTER_IP = '10.0.1.1';
export const MASTER_URL = `http://${MASTER_IP}:3801`;

// Docker Swarm configuration
export const IMAGE_NAME = 'minifarm-client';
export const STACK_NAME = 'minifarm';
export const SERVICE_NAME = `${STACK_NAME}_minifarm-client`;

// Worker configuration
export const DEFAULT_WORKERS = 12
export const EXPECTED_WORKERS = parseInt(process.env.MINIFARM_WORKERS, 10) || DEFAULT_WORKERS;

// Repository list - artifacts must be last (used to determine if all apps need restart)
export const REPOS = [
	'account',
	'clinicians',
	'mtest',
	'office',
	'pdf-generator',
	'hq',
	'artifacts',
	'mobile2'
];

// Apps to manage (repos minus artifacts)
export const APPS = REPOS.filter(repo => repo !== 'artifacts');

// Standalone .env directories (must be updated before Docker build)
export const STANDALONE_ENV_DIRS = [
	path.join(CODE_DIR, 'tests', 'playwright'),
	path.join(CODE_DIR, 'tests', 'ava'),
	'/home/user/code/saml-test',
];

// Apps that need build.vars file
export const BUILD_VARS_APPS = ['account', 'mtest'];

// Environment replacements for minifarm
export const ENV_REPLACEMENTS = [
	{old: '.app.local', new: '.minifarm.local'},
	{old: '.pretend:7000/saml', new: '.minifarm.local/saml'},
];

// Timeouts and intervals
export const DEPLOYMENT_MAX_ATTEMPTS = 60;
export const DEPLOYMENT_INTERVAL_MS = 2000;
export const WORKER_REGISTRATION_MAX_ATTEMPTS = 30;
export const WORKER_REGISTRATION_INTERVAL_MS = 2000;
export const TEST_POLL_INTERVAL_MS = 10000;
export const PM2_WARMUP_MS = 10000;

// hwp concurrency settings
export const CONCURRENCY = {
	REPO_CHECKOUT: 4,
	PACKAGE_LOCK_CHECKSUMS: 7,
	ENV_FILE_UPDATES: 4,
};

// Default export for convenience
export default {
	SCRIPT_DIR,
	CODE_DIR,
	DEVOPS_DIR,
	DEPLOY_DIR,
	APPS_DIR,
	REGISTRY_URL,
	MASTER_IP,
	MASTER_URL,
	IMAGE_NAME,
	STACK_NAME,
	SERVICE_NAME,
	DEFAULT_WORKERS,
	EXPECTED_WORKERS,
	REPOS,
	APPS,
	STANDALONE_ENV_DIRS,
	BUILD_VARS_APPS,
	ENV_REPLACEMENTS,
	DEPLOYMENT_MAX_ATTEMPTS,
	DEPLOYMENT_INTERVAL_MS,
	WORKER_REGISTRATION_MAX_ATTEMPTS,
	WORKER_REGISTRATION_INTERVAL_MS,
	TEST_POLL_INTERVAL_MS,
	PM2_WARMUP_MS,
	CONCURRENCY,
};
