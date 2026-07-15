(function (root, factory) {
  const api = factory(root.MatchboardModel || (typeof require === "function" ? require("./model.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MatchboardStore = api.MatchboardStore;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model) {
  "use strict";

  const STATE_KEY = "indoor-matchboard-state-v2";
  const CONFIG_KEY = "indoor-matchboard-sync-v1";

  class MatchboardStore {
    constructor() {
      this.state = Model.createInitialState();
      this.serverState = null;
      this.revision = 0;
      this.listeners = new Set();
      this.statusListeners = new Set();
      this.pending = [];
      this.queue = Promise.resolve();
      this.pollTimer = null;
      this.config = this.readConfig();
      this.mode = this.config.endpoint ? "remote" : "local";
      this.status = { mode: this.mode, state: this.mode === "remote" ? "syncing" : "local", message: "" };
    }

    readConfig() {
      try {
        const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
        return { endpoint: String(parsed.endpoint || "").trim(), accessKey: String(parsed.accessKey || "") };
      } catch (_) {
        return { endpoint: "", accessKey: "" };
      }
    }

    saveConfig() {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    }

    readLocal() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? Model.normalizeState(JSON.parse(raw)) : Model.createInitialState();
      } catch (_) {
        return Model.createInitialState();
      }
    }

    writeLocal(state) {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    onStatus(listener) {
      this.statusListeners.add(listener);
      listener(this.status);
      return () => this.statusListeners.delete(listener);
    }

    emit() {
      this.listeners.forEach((listener) => listener(this.state));
    }

    setStatus(state, message) {
      this.status = { mode: this.mode, state, message: message || "" };
      this.statusListeners.forEach((listener) => listener(this.status));
    }

    async init() {
      this.state = this.readLocal();
      this.emit();
      if (!this.config.endpoint) {
        this.mode = "local";
        this.setStatus("local", "この端末に保存しています");
        return this.state;
      }
      this.mode = "remote";
      this.setStatus("syncing", "共有データを読み込んでいます");
      try {
        const payload = await this.remoteLoad();
        if (payload.data) {
          this.revision = Number(payload.revision) || 0;
          this.serverState = Model.normalizeState(payload.data);
          this.state = Model.deepClone(this.serverState);
          this.writeLocal(this.state);
        } else {
          this.serverState = Model.deepClone(this.state);
          const created = await this.remoteSave(this.serverState, Number(payload.revision) || 0);
          this.revision = Number(created.revision) || 1;
        }
        this.setStatus("online", "共有中");
        this.emit();
        this.startPolling();
      } catch (error) {
        this.setStatus("error", error.message || "共有データを読み込めませんでした");
      }
      return this.state;
    }

    async connect(endpoint, accessKey) {
      const normalized = String(endpoint || "").trim();
      if (!/^https:\/\/script\.google\.com\//i.test(normalized)) {
        throw new Error("GASウェブアプリのURL（https://script.google.com/...）を入力してください");
      }
      const previous = {
        config: { ...this.config }, mode: this.mode, serverState: this.serverState,
        revision: this.revision, state: Model.deepClone(this.state),
      };
      this.stopPolling();
      this.config = { endpoint: normalized, accessKey: String(accessKey || "") };
      this.mode = "remote";
      this.setStatus("syncing", "接続を確認しています");
      try {
        const payload = await this.remoteLoad();
        if (payload.data) {
          this.revision = Number(payload.revision) || 0;
          this.serverState = Model.normalizeState(payload.data);
          this.state = Model.deepClone(this.serverState);
        } else {
          this.serverState = Model.deepClone(this.state);
          const created = await this.remoteSave(this.serverState, Number(payload.revision) || 0);
          this.revision = Number(created.revision) || 1;
        }
      } catch (error) {
        this.config = previous.config;
        this.mode = previous.mode;
        this.serverState = previous.serverState;
        this.revision = previous.revision;
        this.state = previous.state;
        if (this.mode === "remote") this.startPolling();
        this.setStatus(this.mode === "remote" ? "online" : "local", this.mode === "remote" ? "元の共有先へ戻しました" : "この端末に保存しています");
        throw error;
      }
      this.saveConfig();
      this.writeLocal(this.state);
      this.setStatus("online", "共有中");
      this.emit();
      this.startPolling();
    }

    disconnect() {
      this.stopPolling();
      this.config = { endpoint: "", accessKey: "" };
      this.saveConfig();
      this.mode = "local";
      this.serverState = null;
      this.revision = 0;
      this.pending = [];
      this.writeLocal(this.state);
      this.setStatus("local", "この端末に保存しています");
    }

    async mutate(mutator, label) {
      if (typeof mutator !== "function") return;
      mutator(this.state);
      this.state.updatedAt = new Date().toISOString();
      Model.pruneOrphans(this.state);
      this.state = Model.normalizeState(this.state);
      this.writeLocal(this.state);
      this.emit();

      if (this.mode !== "remote") {
        this.setStatus("local", "この端末に保存しました");
        return;
      }

      const item = { id: Model.uid("mutation"), mutator, label: label || "変更" };
      this.pending.push(item);
      this.setStatus("syncing", `${item.label}を共有しています`);
      this.enqueueMutation(item);
      return this.queue;
    }

    enqueueMutation(item) {
      this.queue = this.queue.then(() => this.syncMutation(item)).catch((error) => {
        this.setStatus("error", error.message || "共有に失敗しました。再試行します");
        if (!item.retryTimer) {
          item.retryTimer = setTimeout(() => {
            item.retryTimer = null;
            if (this.mode === "remote" && this.pending.some((pending) => pending.id === item.id)) this.enqueueMutation(item);
          }, 3000);
        }
      });
    }

    async syncMutation(item) {
      const itemIndex = this.pending.findIndex((pending) => pending.id === item.id);
      if (itemIndex < 0) return;
      const batch = this.pending.slice(0, itemIndex + 1);
      let base = Model.deepClone(this.serverState || this.state);
      let revision = this.revision;
      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = Model.deepClone(base);
        batch.forEach((pending) => pending.mutator(candidate));
        candidate.updatedAt = new Date().toISOString();
        Model.pruneOrphans(candidate);
        try {
          response = await this.remoteSave(Model.normalizeState(candidate), revision);
          this.revision = Number(response.revision) || revision + 1;
          this.serverState = response.data ? Model.normalizeState(response.data) : Model.normalizeState(candidate);
          break;
        } catch (error) {
          if (!error.conflict || !error.payload || !error.payload.data) throw error;
          base = Model.normalizeState(error.payload.data);
          revision = Number(error.payload.revision) || revision;
        }
      }
      if (!response) throw new Error("同時編集との統合に失敗しました。もう一度操作してください");
      const completedIds = new Set(batch.map((pending) => pending.id));
      batch.forEach((pending) => { if (pending.retryTimer) clearTimeout(pending.retryTimer); });
      this.pending = this.pending.filter((pending) => !completedIds.has(pending.id));
      const rebuilt = Model.deepClone(this.serverState);
      this.pending.forEach((pending) => pending.mutator(rebuilt));
      this.state = Model.normalizeState(rebuilt);
      this.writeLocal(this.state);
      this.emit();
      this.setStatus("online", "共有済み");
    }

    endpointUrl(action) {
      const url = new URL(this.config.endpoint);
      url.searchParams.set("action", action);
      url.searchParams.set("t", String(Date.now()));
      if (this.config.accessKey) url.searchParams.set("accessKey", this.config.accessKey);
      return url.toString();
    }

    async remoteLoad() {
      const response = await fetch(this.endpointUrl("load"), { method: "GET" });
      if (!response.ok) throw new Error(`共有サーバーの応答エラー (${response.status})`);
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "共有データを読み込めませんでした");
      return payload;
    }

    async remoteSave(data, baseRevision) {
      const params = new URLSearchParams();
      params.set("action", "save");
      params.set("baseRevision", String(baseRevision || 0));
      params.set("data", JSON.stringify(data));
      if (this.config.accessKey) params.set("accessKey", this.config.accessKey);
      const response = await fetch(this.config.endpoint, { method: "POST", body: params });
      if (!response.ok) throw new Error(`共有サーバーの応答エラー (${response.status})`);
      const payload = await response.json();
      if (!payload.ok) {
        const error = new Error(payload.error || "共有データを保存できませんでした");
        error.conflict = payload.code === "REVISION_CONFLICT";
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    startPolling() {
      this.stopPolling();
      this.pollTimer = setInterval(() => this.poll(), 3000);
    }

    stopPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    async poll() {
      if (this.mode !== "remote" || this.pending.length) return;
      try {
        const payload = await this.remoteLoad();
        const revision = Number(payload.revision) || 0;
        if (payload.data && revision > this.revision) {
          this.revision = revision;
          this.serverState = Model.normalizeState(payload.data);
          this.state = Model.deepClone(this.serverState);
          this.writeLocal(this.state);
          this.emit();
        }
        this.setStatus("online", "共有中");
      } catch (error) {
        this.setStatus("error", error.message || "再接続を待っています");
      }
    }
  }

  return { MatchboardStore };
});
