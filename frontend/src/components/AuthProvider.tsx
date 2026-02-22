"use client";
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';
import { useRouter, usePathname } from 'next/navigation';

type AuthContextType = {
    user: User | null;
    session: Session | null;
    loading: boolean;
};

const AuthContext = createContext<AuthContextType>({ user: null, session: null, loading: true });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const setData = async () => {
            // Hotfix: Manually intercept the OAuth tokens from the URL if Supabase is too slow to parse them
            if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
                try {
                    const hashStr = window.location.hash.substring(1);
                    const hashParams = new URLSearchParams(hashStr);
                    const access_token = hashParams.get('access_token');
                    const refresh_token = hashParams.get('refresh_token');

                    if (access_token && refresh_token) {
                        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
                        if (error) {
                            console.error(`Supabase setSession Error: ${error.message}`);
                            return;
                        } else if (data.session) {
                            setSession(data.session);
                            setUser(data.session.user);
                            setLoading(false);
                            // Push the router manually and remove the dirty URL since we return early
                            router.replace('/');
                            return;
                        } else {
                            console.warn(`Supabase setSession worked but returned no session?`);
                            return;
                        }
                    } else {
                        console.warn(`Missing tokens in hash`);
                        return;
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(`Exception parsing hash: ${message}`);
                    return;
                }
            }

            // Normal flow for returning visitors
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error) {
                console.error("Error getting session", error);
            }

            // Prevent marking as "loaded" with no user if we are still waiting for Supabase token extraction
            if (!session && typeof window !== 'undefined' &&
                (window.location.hash.includes('access_token=') || window.location.search.includes('code='))) {
                return;
            }

            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        setData();

        return () => {
            subscription.unsubscribe();
        };
    }, [router]);

    // Route Protection Logic
    useEffect(() => {
        if (!loading) {
            if (!user) {
                // Prevent Next.js from destroying the URL before Supabase reads the OAuth callback
                if (typeof window !== 'undefined' &&
                    (window.location.hash.includes('access_token=') ||
                        window.location.hash.includes('error_description=') ||
                        window.location.search.includes('code=') ||
                        window.location.search.includes('error='))
                ) {
                    return;
                }
                if (pathname !== '/login') {
                    router.push('/login');
                }
            } else {
                // User is authenticated!
                if (pathname === '/login') {
                    router.replace('/');
                } else if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
                    // Clean up the ugly URL hash now that we are logged in
                    router.replace(pathname);
                }
            }
        }
    }, [user, loading, pathname, router]);

    return (
        <AuthContext.Provider value={{ user, session, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};
