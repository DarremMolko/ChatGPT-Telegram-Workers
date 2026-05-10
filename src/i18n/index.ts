import type { I18n } from './types';
import en from './en';

export default function loadI18n(lang?: string): I18n {
    void lang;
    return en;
}
