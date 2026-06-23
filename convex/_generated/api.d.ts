/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as calendar from "../calendar.js";
import type * as clerkInvites from "../clerkInvites.js";
import type * as customers from "../customers.js";
import type * as documents from "../documents.js";
import type * as lib_approvalEngine from "../lib/approvalEngine.js";
import type * as lib_auth from "../lib/auth.js";
import type * as messages from "../messages.js";
import type * as modules from "../modules.js";
import type * as modules_accounting_accounts from "../modules/accounting/accounts.js";
import type * as modules_accounting_finalize from "../modules/accounting/finalize.js";
import type * as modules_accounting_ledger from "../modules/accounting/ledger.js";
import type * as superadmin from "../superadmin.js";
import type * as tasks from "../tasks.js";
import type * as team from "../team.js";
import type * as threads from "../threads.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  calendar: typeof calendar;
  clerkInvites: typeof clerkInvites;
  customers: typeof customers;
  documents: typeof documents;
  "lib/approvalEngine": typeof lib_approvalEngine;
  "lib/auth": typeof lib_auth;
  messages: typeof messages;
  modules: typeof modules;
  "modules/accounting/accounts": typeof modules_accounting_accounts;
  "modules/accounting/finalize": typeof modules_accounting_finalize;
  "modules/accounting/ledger": typeof modules_accounting_ledger;
  superadmin: typeof superadmin;
  tasks: typeof tasks;
  team: typeof team;
  threads: typeof threads;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
