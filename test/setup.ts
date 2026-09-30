// Runs in every test worker before the suites: the throwaway DATABASE_URL was set by
// globalSetup, and NODE_ENV is 'test' so the server does not start listening.
process.env.NODE_ENV = 'test';
