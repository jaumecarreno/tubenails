"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    DEFAULT_LANGUAGE,
    isLanguage,
    Language,
    LANGUAGE_STORAGE_KEY,
    LANGUAGE_TO_LOCALE,
    translate,
    TranslateVariables
} from '@/lib/i18n';

type LanguageContextType = {
    language: Language;
    locale: string;
    setLanguage: (language: Language) => void;
    t: (key: string, variables?: TranslateVariables) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
    const [language, setLanguageState] = useState<Language>(() => {
        if (typeof window === 'undefined') {
            return DEFAULT_LANGUAGE;
        }
        const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        return isLanguage(storedLanguage) ? storedLanguage : DEFAULT_LANGUAGE;
    });

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
        document.documentElement.lang = language;
    }, [language]);

    const setLanguage = useCallback((nextLanguage: Language) => {
        setLanguageState(nextLanguage);
    }, []);

    const t = useCallback(
        (key: string, variables?: TranslateVariables) => translate(language, key, variables),
        [language]
    );

    const value = useMemo(
        () => ({
            language,
            locale: LANGUAGE_TO_LOCALE[language],
            setLanguage,
            t
        }),
        [language, setLanguage, t]
    );

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useI18n = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useI18n must be used inside LanguageProvider');
    }
    return context;
};
