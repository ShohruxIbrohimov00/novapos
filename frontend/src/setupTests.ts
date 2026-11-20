// Vitest: har testdan keyin React komponentlari olib tashlanadi (hodisa tinglovchilari qolmasin)
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
