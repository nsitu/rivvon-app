import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import BackgroundLoopLab from '../src/components/slyce/BackgroundLoopLab.vue';
import '../src/components/viewer/toolsPanelShared.css';

createApp(BackgroundLoopLab).use(PrimeVue, { theme: { preset: Aura } }).mount('#app');
