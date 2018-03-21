import * as ts_module from "typescript/lib/tsserverlibrary";
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as resolve from 'resolve';
import * as SyncCore from 'css-modules-loader-core-sync';
import * as less from 'less';
import * as sass from 'sass';

function getLogger(...args: any[]) {
    const tempLogFile = 'D:/temp/test.log';
    return {
        info(msg: string) {
            return;
            fs.appendFileSync(tempLogFile, `\n[${new Date}]${msg}`);
        },
        clear() {
            return;
            fs.unlinkSync(tempLogFile)
        },
        trace(msg) {
            return;
            this.info(`${msg}
            ${new Error().stack.split('\n').slice(3, 10).join('\n')}`);
        }
    }
}

interface CallHookContext {
    args: any[];
}
interface BeforeCallHookContext extends CallHookContext {
    override(): void;
}
interface DtsRecord {
    filename: string;
    content?: string;
    lastModify: number;
    update(): void;
    checkUpdate(mtime: Date): void;
};

type BeforeCallHook = (context: BeforeCallHookContext) => any;
type AfterCallHook = (res: any, context: CallHookContext) => any;

const styleExtensions = [
    '.css',
    '.less',
    '.scss',
    '.sass',
];


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

    const cssDtsMap: { [filename: string]: DtsRecord } = {};

    const cssMap: { [filename: string]: { filename: string } } = {};

    decorate(fs, 'stat',
        function ({ args: [filename, callback], override }) {
            const dtsRecord = cssDtsMap[filename];

            if (dtsRecord) {
                override();
                getLogger().info(`pull change, ${filename}`);

                fs.stat(dtsRecord.filename, function (err, stat) {
                    if (stat) {
                        const originMtime = stat.mtime;

                        dtsRecord.checkUpdate(originMtime);

                        stat.mtime = new Date(dtsRecord.lastModify);
                    }
                    callback(err, stat);
                });
            }
        },
        null);

    decorate(fs, 'statSync',
        function ({ args: [filename], override }) {
            const dtsRecord = cssDtsMap[filename];
            if (dtsRecord) {
                override();
                const stat = fs.statSync(cssDtsMap[filename].filename);
                const originMtime = stat.mtime;

                dtsRecord.checkUpdate(originMtime);


                stat.mtime = new Date(dtsRecord.lastModify);

                return stat;
            }
        },
        null);

    decorate(fs, 'readFileSync',
        function ({ args: [filename], override }) {
            const dtsRecord = cssDtsMap[filename];

            if (dtsRecord) {
                override();
                const dts = dtsRecord.content;

                getLogger().trace(`fs.readFileSync ${filename} 
                ${dts}`);

                return dts || emptyDts;
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
                        styleExtensions.indexOf(extension) != -1
                    ) {

                        const definitionName = importNamePath + ts.Extension.Dts;
                        const cssFileName = path.basename(importNamePath) + '.css';

                        res[i] = {
                            resolvedFileName: definitionName,
                            extension: ts.Extension.Dts,
                        };

                        if (!cssDtsMap[definitionName]) {
                            const dtsRecord: DtsRecord = {
                                filename: importNamePath,
                                lastModify: 0,
                                update() {
                                    getLogger().info(`getRootFiles ${info.project.getRootFiles()}`);

                                    const source = fs.readFileSync(importNamePath, { encoding: 'utf8' });

                                    // 这里没有明确的强制时序，但是应该不存在race condition 
                                    new Promise<string>(function (resolve, reject) {

                                        if (extension == '.less') {
                                            less.render(source, { filename: importNamePath }).then(function (res) {

                                                getLogger().info(`compiledLessFile ${importNamePath} ${util.inspect(res)}`);

                                                resolve(res.css);
                                            }, function (err) {
                                                reject(err);
                                            });
                                        } else if (extension == '.scss' || extension == '.sass') {
                                            const sassOption = {
                                                data: source,
                                                outFile: cssFileName,
                                                includePaths: [path.dirname(importNamePath), ...info.project.getRootFiles().map(x => path.dirname)],
                                                indentedSyntax: extension == '.sass',
                                            };

                                            const res = sass.renderSync(sassOption);
                                            getLogger().info(`compiledScssFile ${importNamePath} ${util.inspect(res)}`);

                                            resolve(res.css);
                                        } else if (extension == '.css') {
                                            resolve(source);
                                        }
                                    }).then(function (cssSource) {
                                        const dtsSource = cssSourceToDts(cssSource, importNamePath);
                                        dtsRecord.content = dtsSource;

                                        getLogger().info(`dtsRecord ${importNamePath} updated`);
                                        
                                        dtsRecord.lastModify += 1;
                                    }).catch(function(e){
                                        getLogger().info(`create dts failed ${e}`);
                                        
                                    });
                                },
                                checkUpdate(originMtime: Date) {
                                    if (dtsRecord.lastModify) {
                                        if (originMtime.getTime() > dtsRecord.lastModify) {
                                            dtsRecord.lastModify = originMtime.getTime();
                                            dtsRecord.update();
                                        }
                                    }
                                }
                            };
                            dtsRecord.update();

                            cssDtsMap[definitionName] = dtsRecord;
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
