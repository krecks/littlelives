import '@fontsource-variable/inter';
import './ui/theme.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installLogCapture } from './debug/log';

installLogCapture();
mount(App, { target: document.getElementById('app')! });
