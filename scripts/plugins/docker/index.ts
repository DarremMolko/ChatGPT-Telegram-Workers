import * as fs from 'node:fs/promises';
import path from 'node:path';

const dockerfile = `
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /build
COPY package.json /build/
RUN npm install --omit=dev

FROM node:24-alpine AS prod

WORKDIR /app
COPY --from=builder /build/node_modules /app/node_modules
COPY . /app/
EXPOSE 8787
CMD ["node", "index.js"]
`;

export function createDockerPlugin(targetDir: string) {
    return {
        name: 'docker',
        async closeBundle() {
            await fs.writeFile(path.resolve(targetDir, 'Dockerfile'), dockerfile.trim());

            const packageJsonPath = path.resolve(process.cwd(), 'package.json');
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            const cleanedPackageJson = {
                name: packageJson.name,
                type: packageJson.type,
                version: packageJson.version,
                dependencies: packageJson.dependencies,
            };

            await fs.writeFile(
                path.resolve(targetDir, 'package.json'),
                JSON.stringify(cleanedPackageJson, null, 2),
            );
        },
    };
}
