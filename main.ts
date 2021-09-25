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
  template: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  template: "{{text}}",
};

const apiUrl =
  "https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&origin=*&titles=";

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  parseResponse(json: any): WikiExtract[] {
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

  formatExtractInsert(extract: WikiExtract): string {
    const formattedText = extract.text.split("==")[0].trim();
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{title}}", extract.title)
      .replace("{{url}}", "https://wikipedia.org/Obsidian");
    return formattedTemplate;
  }

  async getWikipediaText(title: string): Promise<WikiExtract> {
    console.log("getting wiki response");
    const url = apiUrl + encodeURIComponent(title);
    const json = await fetch(url).then((response) => response.json());
    const extracts = this.parseResponse(json);
    return extracts[0];
  }

  async getWikipediaTextForActiveFile() {
    const activeNoteTitle = await this.app.workspace.getActiveFile().basename;
    const extract: WikiExtract = await this.getWikipediaText(activeNoteTitle);
    const editor = this.getEditor();
    editor.replaceSelection(this.formatExtractInsert(extract));
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

    containerEl.createEl("h2", { text: "Obsidian Wikipedia" });

    new Setting(containerEl)
      .setName("Wikipedia Extract Template")
      .setDesc(
        "Set markdown template for extract to be inserted. Available variables are {{title}}, {{text}}, and {{URL}}."
      )
      .addTextArea((textarea) =>
        textarea
          .setPlaceholder("Enter your secret")
          .setValue("")
          .onChange(async (value) => {
            console.log(value);
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
