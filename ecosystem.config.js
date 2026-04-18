module.exports = {
    apps: [{
        name: 'ticket-notifier',
        script: 'src/server.js',
        cwd: __dirname,
        env: {
            NODE_ENV: 'production',
            PORT: 3000,

            // ── Plugin Mode (CRITICAL: keeps bot passive, no Discord Gateway) ──
            PLUGIN_MODE: '1',

            // ── Plugin Bridge Secret (must match Vencord plugin settings) ──
            PLUGIN_SECRET: 'ticket-notifier-plugin-2026',

            // ── Data Directory ──
            DATA_DIR: './data',
        },
        // Memory limit — restart if exceeds (4GB RAM laptop, stay under 300MB)
        max_memory_restart: '300M',
        autorestart: true,
        watch: false,
        // Logs
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: './logs/error.log',
        out_file: './logs/output.log',
        merge_logs: true,
        // Restart policies
        max_restarts: 20,
        min_uptime: '10s',
        restart_delay: 3000,
    }]
};
