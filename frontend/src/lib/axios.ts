import axios from 'axios';
import { supabase } from './supabase';

// Create a custom axios instance
const api = axios.create();

// Add a request interceptor to inject the Supabase JWT
api.interceptors.request.use(async (config) => {
    // Only inject for API routes
    if (config.url?.startsWith('/api/')) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            config.headers.Authorization = `Bearer ${session.access_token}`;
        }
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

export default api;
