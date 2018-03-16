import * as ts_module from "typescript/lib/tsserverlibrary";
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as resolve from 'resolve';
import * as SyncCore from 'css-modules-loader-core-sync';
import * as less from 'less';

function getLogger(...args: any[]) {
    const tempLogFile = 'D:/temp/test.log';
    return {
        info(msg: string) {
            // return;
            fs.appendFileSync(tempLogFile, `\n[${new Date}]${msg}`);
        },
        clear() {
            // return;
            fs.unlinkSync(tempLogFile)
        },
        trace(msg) {
            // return;
            this.info(`${msg}
            ${new Error().stack.split('\n').slice(3,10).join('\n')}`);
        }
    }
}

interface CallHookContext {
    args: any[];
}
interface BeforeCallHookContext extends CallHookContext {
    override(): void;
}

type BeforeCallHook = (context: BeforeCallHookContext) => any;
type AfterCallHook = (res: any, context: CallHookContext) => any;

function decorate(host: {}, method: string, before: BeforeCallHook, after: AfterCallHook) {
    const origin = host[method] as Function & { hooked?: boolean };
    if ('hooked' in origin && origin.hooked) {
        getLogger().info(`hooked method ${method}`);
        return;
    }

    getLogger().info(`hooking method [${method}] ${host[method]}`);

    host[method] = function (...args: any[]) {
        let override = false;
        let ret = before && before.call(this, { args, override() { override = true } });
        if (!override) {
            ret = origin.apply(this, args);
        }

        after && after.call(this, ret, { args });
        return ret;
    };
    host[method].hooked = true;
}

function pathFetcher(filepath, relativeTo) {
    return resolve.sync(filepath.replace(/["']/g, ''), {
        basedir: path.dirname(relativeTo)
    });
}



function readCssDtsFile(cssFileName: string) {
    const src = fs.readFileSync(cssFileName, {
        encoding: 'utf8'
    });
    return cssSourceToDts(src, cssFileName);
}

function cssSourceToDts(src: string, cssFileName: string) {
    const syncCore = new SyncCore();
    const result = syncCore.load(src, cssFileName, '', pathFetcher);
    getLogger().info(`create css definition ${cssFileName}`);
    return createDtsFile(result.exportTokens);
}

function createDtsFile(tokens) {
    const objToExports = {};
    Object.keys(tokens).forEach(x => objToExports[x] = ';');

    const lines = JSON.stringify(objToExports, null, 4).split('\n')
        .map(x => x.replace(/: \"\;\",?$/, ': string,'));

    return `
    declare const tokens: ${lines.join('\n')};
    export = tokens;
  `;
}
const emptyDts = `
    declare const tokens: {
        [k: string] : string;
    };
    export = tokens;
`;

function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    const cssDtsMap: {
        [filename: string]: { filename: string, content?: string }
    } = {};

    const cssMap: {
        [filename: string]: { filename: string }
    } = {};

    decorate(fs, 'statSync',
        function ({ args: [filename], override }) {
            if (cssDtsMap[filename]) {
                override();
                const stat = fs.statSync(cssDtsMap[filename].filename);
                const originMtime = stat.mtime;
                if (cssDtsMap[filename].content) {
                    stat.mtime = new Date(originMtime.getTime() + 1);
                }
                return stat;
            }
        },
        null);
    
    decorate(fs, 'readFileSync',
        function ({ args: [filename], override }) {
            if (cssDtsMap[filename]) {
                override();
                const dts = cssDtsMap[filename].content;

                getLogger().trace(`fs.readFileSync ${filename} 
                ${dts}`);

                return dts || emptyDts;
            }
        },
        null);
    decorate(fs, 'stat',
        function ({ args: [filename, callback], override }) {
            if (cssDtsMap[filename]) {
                override();
                fs.stat(cssDtsMap[filename].filename, function (err, stat) {
                    if (stat) {
                        const originMtime = stat.mtime;
                        if (cssDtsMap[filename].content) {
                            stat.mtime = new Date(originMtime.getTime() + 1);
                        }
                    }
                    callback(err, stat);
                });
            }
        },
        null);


    function create(info: ts_module.server.PluginCreateInfo) {
        // Get a list of things to remove from the completion list from the config object.
        // If nothing was specified, we'll just remove 'caller'
        const whatToRemove: string[] = info.config.remove || ['caller'];

        getLogger().clear();
        // Diagnostic logging
        getLogger().info("I'm getting set up now! Check the log for this message.");

        // Set up decorator
        const proxy: ts_module.LanguageService = Object.create(null);
        for (let k of Object.keys(info.languageService) as Array<keyof ts_module.LanguageService>) {
            const x = info.languageService[k];
            proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
        }

        proxy.getDefinitionAtPosition = function (fileName, position) {
            const ret: ts_module.DefinitionInfo[] = [];
            const originInfo = info.languageService.getDefinitionAtPosition(fileName, position);

            getLogger().trace(`getDefinitionAtPosition ${fileName} ${util.inspect(originInfo)}`);

            originInfo && originInfo.forEach(function (def) {
                if (cssDtsMap[def.fileName]) {
                    def.fileName = cssDtsMap[def.fileName].filename;
                    def.textSpan = {
                        start: 0,
                        length: 0
                    };
                }
                ret.push(def);
            });

            return ret;
        }

        decorate(info.languageServiceHost, 'resolveModuleNames',
            null,
            function (res: ts_module.ResolvedModuleFull[], { args: [moduleNames, containingFile] }) {
                const containFileDir = path.dirname(containingFile);

                getLogger().trace(`resolveModuleNames ${containingFile} ${util.inspect(moduleNames)}`);

                moduleNames.forEach((importName, i) => {
                    if (res[i]) {
                        return;
                    }
                    const importNamePath = path.join(containFileDir, importName).replace(/\\/g, '/');

                    const exists = fs.existsSync(importNamePath);
                    const extension = path.extname(importNamePath);
                    if (exists &&
                        (extension === '.css'
                            || extension === '.less')
                    ) {

                        const definitionName = importNamePath + ts.Extension.Dts;
                        res[i] = {
                            resolvedFileName: definitionName,
                            extension: ts.Extension.Dts,
                        };

                        if (!cssDtsMap[definitionName]) {
                            cssDtsMap[definitionName] = {
                                filename: importNamePath,
                            };

                            new Promise<string>(function (resolve) {
                                if (extension == '.less') {
                                    const lessSource = fs.readFileSync(importNamePath, { encoding: 'utf8' });
                                    less.render(lessSource, { filename: importNamePath }).then(function (res) {
                                        
                                        getLogger().trace(`compiledLessFile ${importNamePath} ${res.css}`);

                                        resolve(cssSourceToDts(res.css, importNamePath));
                                    });
                                } else if (extension == '.css') {
                                    resolve(readCssDtsFile(importNamePath));;
                                }
                            }).then(function (dtsSource) {
                                cssDtsMap[definitionName].content = dtsSource
                            });

                            cssMap[importNamePath] = {
                                filename: importNamePath
                            };
                        }
                    }

                    getLogger().info(`resolveModuleName ${importNamePath} ${exists} exists`);
                });
            });

        decorate(info.project, 'getScriptInfo',
            function ({ args: [filename], override }) {
                if (cssMap[filename]) {
                    getLogger().info(`project.getScriptInfo `);
                    override();
                    return {
                        positionToLineOffset() {
                            return { line: 1, offset: 1 };
                        }
                    };
                }
            }, null);

        return proxy;
    }

    return { create };
}

export = init;
