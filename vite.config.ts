import type { Plugin } from 'vite';
import * as path from 'node:path';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import cleanup from 'rollup-plugin-cleanup';
import nodeExternals from 'rollup-plugin-node-externals';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import { createDockerPlugin } from './scripts/plugins/docker';
import { createVersionPlugin, versionDefine } from './scripts/plugins/version';

const plugins: Plugin[] = [
    nodeResolve({
        preferBuiltins: true,
    }),
    cleanup({
        comments: 'none',
        extensions: ['js', 'ts'],
    }),
    checker({
        typescript: true,
    }),
    createDockerPlugin('dist'),
    createVersionPlugin('dist'),
    nodeExternals(),
];

export default defineConfig({
    plugins,
    build: {
        target: 'es2022',
        rollupOptions: {
            external: [
                'ws',
                '@ai-sdk/google-vertex',
                '@ai-sdk/mcp',
                '@ai-sdk/mcp/mcp-stdio',
                'node:buffer',
                'node-cron',
                'child_process',
                'node:child_process',
                'node:fs',
                'node:path',
                'node:fs/promises',
            ],
        },
        lib: {
            entry: path.resolve(__dirname, 'src/adapter/local/index.ts'),
            fileName: 'index',
            formats: ['es'],
        },
        outDir: 'dist',
        minify: false,
        emptyOutDir: true,
    },
    define: {
        ...versionDefine,
    },
});
