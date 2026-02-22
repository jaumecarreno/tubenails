"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { useI18n } from './LanguageProvider';
import { LanguageSelector } from './LanguageSelector';

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
    const { user, loading } = useAuth();
    const pathname = usePathname();
    const { t } = useI18n();

    if (loading) {
        return null;
    }

    if (!user || pathname === '/login') {
        if (pathname === '/login') {
            return (
                <div className="relative min-h-screen">
                    <div className="absolute right-4 top-4 z-20">
                        <LanguageSelector compact />
                    </div>
                    {children}
                </div>
            );
        }
        return <>{children}</>;
    }

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    return (
        <div className="flex h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 overflow-hidden">
            <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-surface-dark border-r border-slate-200 dark:border-slate-700 flex flex-col transition-transform duration-300 transform -translate-x-full lg:translate-x-0 lg:static lg:inset-auto flex-shrink-0">
                <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-200 dark:border-slate-700">
                    <div className="relative flex flex-shrink-0 items-center justify-center w-8 h-8 rounded bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-xl">ads_click</span>
                        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full border-2 border-white dark:border-surface-dark"></div>
                    </div>
                    <div className="flex flex-col">
                        <h1 className="font-bold text-lg tracking-tight leading-none">CTR Sniper</h1>
                        <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Beta</span>
                    </div>
                </div>

                <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
                    <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors ${pathname === '/' ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surface-dark-hover hover:text-slate-900 dark:hover:text-white'}`}>
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: pathname === '/' ? "'FILL' 1" : "'FILL' 0" }}>dashboard</span>
                        {t('layout.nav.dashboard')}
                    </Link>
                    <Link href="/new" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors ${pathname === '/new' ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surface-dark-hover hover:text-slate-900 dark:hover:text-white'}`}>
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: pathname === '/new' ? "'FILL' 1" : "'FILL' 0" }}>add_circle</span>
                        {t('layout.nav.newTest')}
                    </Link>
                    <Link href="/settings" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors ${pathname === '/settings' ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surface-dark-hover hover:text-slate-900 dark:hover:text-white'}`}>
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: pathname === '/settings' ? "'FILL' 1" : "'FILL' 0" }}>settings</span>
                        {t('layout.nav.settings')}
                    </Link>
                </nav>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
                    <LanguageSelector />
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-9 h-9 flex-shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden ring-2 ring-transparent hover:ring-slate-300 dark:hover:ring-slate-600 transition-all cursor-pointer bg-cover bg-center" style={{ backgroundImage: `url('${user.user_metadata.avatar_url || ''}')` }}>
                            {!user.user_metadata.avatar_url && <span className="material-symbols-outlined text-slate-500 w-full h-full flex items-center justify-center">person</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{user.user_metadata.full_name || t('layout.profile.userFallback')}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                        </div>
                        <button onClick={handleLogout} title={t('layout.profile.logout')} className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors">
                            <span className="material-symbols-outlined text-[20px]">logout</span>
                        </button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto relative">
                {children}
            </main>
        </div>
    );
};
