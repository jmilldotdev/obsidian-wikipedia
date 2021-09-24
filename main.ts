import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
} from "obsidian";

interface WikiExtract {
  title: string;
  text: string;
}

interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: "default",
};

const apiUrl =
  "https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&origin=*&titles=";

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  parseResponse(json: any) {
    const pages = json.query.pages;
    const extracts: WikiExtract[] = Object.keys(pages).map((key) => {
      const page = pages[key];
      const extract: WikiExtract = {
        title: page.title,
        text: page.extract,
      };
      return extract;
    });
    return extracts;
  }

  async getWikipediaText(title: string) {
    console.log("getting wiki response");
    const url = apiUrl + encodeURIComponent(title);
    const json = await fetch(url).then((response) => response.json());
    const extracts = this.parseResponse(json);
    return extracts[0];
  }

  async getWikipediaTextForActiveFile() {
    const activeNoteTitle = await this.app.workspace.getActiveFile().basename;
    const extract: WikiExtract = await this.getWikipediaText(activeNoteTitle);
    const formatted = extract.text.split("==")[0].trim();
    const editor = this.getEditor();
    editor.replaceSelection(formatted);
  }

  async onload() {
    console.log("loading plugin");

    await this.loadSettings();

    this.addCommand({
      id: "wikipedia-get-active-note-title",
      name: "Wikipedia: Get Active Note Title",
      callback: () => this.getWikipediaTextForActiveFile(),
    });

    this.addSettingTab(new SampleSettingTab(this.app, this));
  }

  onunload() {
    console.log("unloading plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getEditor(): Editor {
    let activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeLeaf == null) return;
    return activeLeaf.editor;
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Settings for my awesome plugin." });

    new Setting(containerEl)
      .setName("Setting #1")
      .setDesc("It's a secret")
      .addText((text) =>
        text
          .setPlaceholder("Enter your secret")
          .setValue("")
          .onChange(async (value) => {
            console.log("Secret: " + value);
            this.plugin.settings.mySetting = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
