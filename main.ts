import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
  TextAreaComponent,
  TextComponent,
} from "obsidian";

interface WikiExtract {
  title: string;
  text: string;
  url: string;
}

interface MyPluginSettings {
  template: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  template: `{{text}}`,
};

const extractApiUrl =
  "https://en.wikipedia.org/w/api.php?" +
  "format=json&action=query&prop=extracts&explaintext=1&redirects&origin=*&titles=";

const disambiguationIdentifier = "may refer to:";
export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  getUrl(title: string): string {
    return `https://en.wikipedia.org/wiki/${encodeURI(title)}`;
  }

  formatExtractText(extract: WikiExtract): string {
    const { text, title } = extract;
    return (
      "> " +
      text
        .split("==")[0]
        .trim()
        .replace(title, `**${title}**`)
        .split("\n")
        .join("\n>\n> ")
    );
  }

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found on Wikipedia.`);
  }

  hasDisambiguation(extract: WikiExtract) {
    if (extract.text.includes(disambiguationIdentifier)) {
      return true;
    }
    return false;
  }

  parseResponse(json: any): WikiExtract | undefined {
    const pages = json.query.pages;
    const pageKeys = Object.keys(pages);
    if (pageKeys.includes("-1")) {
      return undefined;
    }
    const extracts: WikiExtract[] = pageKeys.map((key) => {
      const page = pages[key];
      const extract: WikiExtract = {
        title: page.title,
        text: page.extract,
        url: this.getUrl(page.title),
      };
      return extract;
    });
    return extracts[0];
  }

  formatExtractInsert(extract: WikiExtract): string {
    const formattedText = this.formatExtractText(extract);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{title}}", extract.title)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWikipediaText(title: string): Promise<WikiExtract | undefined> {
    const url = extractApiUrl + encodeURIComponent(title);
    const json = await fetch(url).then((response) => response.json());
    const extract = this.parseResponse(json);
    return extract;
  }

  async pasteIntoEditor(searchTerm: string) {
    let extract: WikiExtract = await this.getWikipediaText(searchTerm);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    if (this.hasDisambiguation(extract)) {
      new Notice(
        `Disambiguation found for ${searchTerm}. Choosing first result.`
      );
      const newSearchTerm = extract.text
        .split(disambiguationIdentifier)[1]
        .trim()
        .split(",")[0];
      extract = await this.getWikipediaText(newSearchTerm);
    }
    const editor = this.getEditor();
    editor.replaceSelection(this.formatExtractInsert(extract));
  }

  async getWikipediaTextForActiveFile() {
    const searchTerm = await this.app.workspace.getActiveFile().basename;
    await this.pasteIntoEditor(searchTerm);
  }

  async getWikipediaTextForSearchTerm() {
    new SearchModal(this.app, this).open();
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "wikipedia-get-active-note-title",
      name: "Get Wikipedia for Active Note Title",
      callback: () => this.getWikipediaTextForActiveFile(),
    });

    this.addCommand({
      id: "wikipedia-get-search-term",
      name: "Get Wikipedia for Search Term",
      callback: () => this.getWikipediaTextForSearchTerm(),
    });

    this.addSettingTab(new SampleSettingTab(this.app, this));
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

class SearchModal extends Modal {
  searchTerm: string;
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    let { contentEl } = this;

    contentEl.createEl("h2", { text: "Enter Search Term:" });

    const inputs = contentEl.createDiv("inputs");
    const searchInput = new TextComponent(inputs).onChange((searchTerm) => {
      this.searchTerm = searchTerm;
    });
    searchInput.inputEl.focus();
    searchInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.close();
      }
    });

    const controls = contentEl.createDiv("controls");
    const searchButton = controls.createEl("button", {
      text: "Search",
      cls: "mod-cta",
      attr: {
        autofocus: true,
      },
    });
    searchButton.addEventListener("click", this.close.bind(this));
    const cancelButton = controls.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", this.close.bind(this));
  }

  async onClose() {
    let { contentEl } = this;

    contentEl.empty();
    if (this.searchTerm) {
      await this.plugin.pasteIntoEditor(this.searchTerm);
    }
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
        `Set markdown template for extract to be inserted.\n
        Available template variables are {{title}}, {{paragraph}}, and {{url}}.
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.template)
          .onChange(async (value) => {
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
