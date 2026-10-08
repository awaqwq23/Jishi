export const root: string;
export const currentDirectory: string;
export const previousDirectory: string;
export function artifactName(platform:string,version:string):string;
export function webBuildHash(webRoot?:string):Promise<string>;
