import escapeRegExp from "lodash/string/escapeRegExp";
import startsWith from "lodash/string/startsWith";
import cloneDeep from "lodash/lang/cloneDeep";
import isBoolean from "lodash/lang/isBoolean";
import * as messages from "babel-messages";
import minimatch from "minimatch";
import contains from "lodash/collection/contains";
import traverse from "babel-traverse";
import isString from "lodash/lang/isString";
import isRegExp from "lodash/lang/isRegExp";
import isEmpty from "lodash/lang/isEmpty";
import parse from "./helpers/parse";
import path from "path";
import has from "lodash/object/has";
import fs from "fs";
import * as t from "babel-types";
import slash from "slash";
import pathExists from "path-exists";

export { inherits, inspect } from "util";

/**
 * Test if a filename ends with a compilable extension.
 */

export function canCompile(filename: string, altExts?: Array<string>) {
  let exts = altExts || canCompile.EXTENSIONS;
  let ext = path.extname(filename);
  return contains(exts, ext);
}

/**
 * Default set of compilable extensions.
 */

canCompile.EXTENSIONS = [".js", ".jsx", ".es6", ".es"];

/**
 * Create an array from any value, splitting strings by ",".
 */

export function list(val?: string): Array<string> {
  if (!val) {
    return [];
  } else if (Array.isArray(val)) {
    return val;
  } else if (typeof val === "string") {
    return val.split(",");
  } else {
    return [val];
  }
}

/**
 * Create a RegExp from a string, array, or regexp.
 */

export function regexify(val: any): RegExp {
  if (!val) return new RegExp(/.^/);

  if (Array.isArray(val)) val = new RegExp(val.map(escapeRegExp).join("|"), "i");

  if (isString(val)) {
    // normalise path separators
    val = slash(val);

    // remove starting wildcards or relative separator if present
    if (startsWith(val, "./") || startsWith(val, "*/")) val = val.slice(2);
    if (startsWith(val, "**/")) val = val.slice(3);

    let regex = minimatch.makeRe(val, { nocase: true });
    return new RegExp(regex.source.slice(1, -1), "i");
  }

  if (isRegExp(val)) return val;

  throw new TypeError("illegal type for regexify");
}

/**
 * Create an array from a boolean, string, or array, mapped by and optional function.
 */

export function arrayify(val: any, mapFn?: Function): Array<any> {
  if (!val) return [];
  if (isBoolean(val)) return arrayify([val], mapFn);
  if (isString(val)) return arrayify(list(val), mapFn);

  if (Array.isArray(val)) {
    if (mapFn) val = val.map(mapFn);
    return val;
  }

  return [val];
}

/**
 * Makes boolean-like strings into booleans.
 */

export function booleanify(val: any): boolean | any {
  if (val === "true") return true;
  if (val === "false") return false;
  return val;
}

/**
 * Tests if a filename should be ignored based on "ignore" and "only" options.
 */

export function shouldIgnore(
  filename: string,
  ignore: Array<RegExp | Function> = [],
  only?: Array<RegExp | Function>,
): boolean {
  filename = slash(filename);

  if (only) {
    for (let pattern of only) {
      if (_shouldIgnore(pattern, filename)) return false;
    }
    return true;
  } else if (ignore.length) {
    for (let pattern of ignore) {
      if (_shouldIgnore(pattern, filename)) return true;
    }
  }

  return false;
}

/**
 * Returns result of calling function with filename if pattern is a function.
 * Otherwise returns result of matching pattern Regex with filename.
 */

function _shouldIgnore(pattern: Function | RegExp, filename: string) {
  if (typeof pattern === "function") {
    return pattern(filename);
  } else {
    return pattern.test(filename);
  }
}

/**
 * A visitor for Babel templates, replaces placeholder references.
 */

let templateVisitor = {
  /**
   * 360 NoScope PWNd
   */
  noScope: true,

  enter(node: Object, parent: Object, scope, nodes: Array<Object>) {
    if (t.isExpressionStatement(node)) {
      node = node.expression;
    }

    if (t.isIdentifier(node) && has(nodes, node.name)) {
      this.skip();
      this.replaceInline(nodes[node.name]);
    }
  },

  exit(node: Object) {
    traverse.clearNode(node);
  }
};

/**
 * Create an instance of a template to use in a transformer.
 */

export function template(name: string, nodes?: Array<Object>, keepExpression?: boolean): Object {
  let ast = exports.templates[name];
  if (!ast) throw new ReferenceError(`unknown template ${name}`);

  if (nodes === true) {
    keepExpression = true;
    nodes = null;
  }

  ast = cloneDeep(ast);

  if (!isEmpty(nodes)) {
    traverse(ast, templateVisitor, null, nodes);
  }

  if (ast.body.length > 1) return ast.body;

  let node = ast.body[0];

  if (!keepExpression && t.isExpressionStatement(node)) {
    return node.expression;
  } else {
    return node;
  }
}

/**
 * Parse a template.
 */

export function parseTemplate(loc: string, code: string): Object {
  try {
    let ast = parse(code, { filename: loc, looseModules: true }).program;
    ast = traverse.removeProperties(ast);
    return ast;
  } catch (err) {
    err.message = `${loc}: ${err.message}`;
    throw err;
  }
}

/**
 * Load templates from transformation/templates directory.
 */

function loadTemplates(): Object {
  let templates = {};

  let templatesLoc = path.join(__dirname, "transformation/templates");
  if (!pathExists.sync(templatesLoc)) {
    throw new ReferenceError(messages.get("missingTemplatesDirectory"));
  }

  for (let name of (fs.readdirSync(templatesLoc): Array)) {
    if (name[0] === ".") continue;

    let key  = path.basename(name, path.extname(name));
    let loc  = path.join(templatesLoc, name);
    let code = fs.readFileSync(loc, "utf8");

    templates[key] = parseTemplate(loc, code);
  }

  return templates;
}

try {
  exports.templates = require("../templates.json");
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
  exports.templates = loadTemplates();
}
