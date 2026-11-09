process.env.DATABASE_URL = 'file:./test.db';
process.env.TINYFISH_API_KEY = 'test-key';
process.env.WEBHOOK_SECRET = 'test-secret-123';
process.env.APP_URL = 'https://verity.test';
process.env.VERITY_AGENT_POLL_MS = '1';
delete process.env.TINYFISH_SEARCH_URL;
delete process.env.TINYFISH_FETCH_URL;
delete process.env.TINYFISH_AGENT_URL;
process.env.VERITY_ENABLE_THIRD_PARTY_VENDORS = '1';
process.env.SANDBOX_API_KEY = 'sbx-key';
process.env.SANDBOX_API_SECRET = 'sbx-secret';
process.env.SANDBOX_API_URL = 'https://api.sandbox.co.in';
process.env.VERITY_IGNORE_BLOCKED_REGISTRIES = '1'; // tests drive the simulated provider through the CAPTCHA-blocked California registry
