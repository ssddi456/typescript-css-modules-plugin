# Typescript Css Modules Plugins

**Features**

- IntelliSense for import css mmodules

## Usage
This plugin requires TypeScript 2.4 or later. It can provide intellisense in both JavaScript and TypeScript files within any editor that uses TypeScript to power their language features. This includes [VS Code](https://code.visualstudio.com), [Sublime with the TypeScript plugin](https://github.com/Microsoft/TypeScript-Sublime-Plugin), [Atom with the TypeScript plugin](https://atom.io/packages/atom-typescript), [Visual Studio](https://www.visualstudio.com), and others. 

### With VS Code
To use this plugin with VS Code, first install the plugin and a copy of TypeScript in your workspace:

```bash
npm install --save-dev git+https://git@github.com/ssddi456/typescript-css-modules-plugins.git typescript
```

Then add a `plugins` section to your [`tsconfig.json`](http://www.typescriptlang.org/docs/handbook/tsconfig-json.html) or [`jsconfig.json`](https://code.visualstudio.com/Docs/languages/javascript#_javascript-project-jsconfigjson)

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "typescript-css-modules-plugins"
      }
    ]
  }
}
```

Finally, run the `Select TypeScript version` command in VS Code to switch to use the workspace version of TypeScript for VS Code's JavaScript and TypeScript language support. You can find more information about managing typescript versions [in the VS Code documentation](https://code.visualstudio.com/Docs/languages/typescript#_using-newer-typescript-versions).

And other editors which support typescript language plugins works like this. See [typescript-styled-plugin](https://github.com/Microsoft/typescript-styled-plugin) for more details.
