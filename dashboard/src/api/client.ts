import axios from 'axios';

// Backend URL: set VITE_BACKEND_URL when dashboard is separate from backend
// e.g. VITE_BACKEND_URL=https://my-tunnel.trycloudflare.com
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

const client = axios.create({
    baseURL: BACKEND_URL ? `${BACKEND_URL}/api` : '/api',
    timeout: 15000,
});

client.interceptors.request.use((config) => {
    const token = localStorage.getItem('dashboard_token');
    if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default client;
