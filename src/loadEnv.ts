import dotenvImport from "dotenv";

type DotenvLike = {
  config?: () => unknown;
  default?: {
    config?: () => unknown;
  };
};

export function loadEnv(): void {
  const dotenv = dotenvImport as unknown as DotenvLike;
  const configFn = dotenv.config ?? dotenv.default?.config;
  if (typeof configFn === "function") {
    configFn();
  }
}
