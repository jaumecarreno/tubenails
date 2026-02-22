"use client";

import { ChangeEvent } from 'react';
import { Language, SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { useI18n } from './LanguageProvider';

type LanguageSelectorProps = {
    compact?: boolean;
    className?: string;
};

export const LanguageSelector = ({ compact = false, className = '' }: LanguageSelectorProps) => {
    const { language, setLanguage, t } = useI18n();

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        setLanguage(event.target.value as Language);
    };

    return (
        <label className={`flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 ${className}`}>
            <span className="material-symbols-outlined text-base">translate</span>
            {!compact && <span className="whitespace-nowrap">{t('common.language')}</span>}
            <select
                value={language}
                onChange={handleChange}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary"
            >
                {SUPPORTED_LANGUAGES.map((option) => (
                    <option key={option.code} value={option.code}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
};
