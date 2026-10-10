var SDLSearch = {
  _searchType: "properties",
  _$simpleSearchInput: $("#simple-search"),
  _simpleSearchType: "#simple-search-type",
  _$advancedSearchInputs: $("form input:not([type=hidden])"),
  _$advancedSearchSelects: $("form select"),
  _$advancedFormSubmits: $("form button[type=submit]"),
  _dateFormat: "m/d/Y",

  simpleSearchSettings: {
    properties: {
      template:
        '<div class="clearfix"><div class="float-left">{{location}}</div><div class="float-right">{{blq}}</div></div><div>{{owner}}</div>',
      tokenField: "pid",
      displayField: "location",
      placeholder: "Search by street or street address",
      noResultsTemplate:
        '<li class="list-group-item disabled" >No properties were found. Try another term or use the Advanced Search option.</li>',
      appendResultsTemplate:
        '<li class="list-group-item text-dark clickable" >If your property is not listed, try the Advanced Search option.</li>',
    },
    permits: {
      template:
        '<div class="clearfix"><div class="float-left text-primary"><strong>{{locationAddress}}</strong></div><div class="float-right italic">{{permitOrControl}}</div></div><div class="clearfix"><div class="float-left text-primary">{{workTypeLabel}}</div><div class="float-right">Status - {{applicationStatusLabel}}</div></div>',
      tokenField: "ppid",
      displayField: "permitOrControl",
      placeholder:
        "Search by a permit number, control number or street address",
      noResultsTemplate:
        '<li class="list-group-item disabled" >No permits were found. Try another term or use the Advanced Search option.</li>',
      appendResultsTemplate:
        '<li class="list-group-item text-dark clickable" >If your permit is not listed, try the Advanced Search option.</li>',
    },
    complaints: {
      template:
        '<div class="clearfix"><div class="float-left text-primary"><strong>{{locationAddress}}</strong></div><div class="float-right italic">{{trackingID}}</div></div><div class="clearfix"><div class="float-left text-primary">{{complaintTypeLabel}}</div><div class="float-right">Status - {{statusTypeLabel}}</div></div>',
      tokenField: "cid",
      displayField: "trackingNumber",
      placeholder: "Search by a tracking number or street address",
      noResultsTemplate:
        '<li class="list-group-item disabled" >No complaints were found with that search term. Please try again.</li>',
      appendResultsTemplate: null,
    },
  },

  init: function () {
    ("use strict");
    this.simpleSearch = this._$simpleSearchInput.sdlGeneralSearch({
      onSelected: this.onSelected.bind(this),
      // onClear: this.onClear.bind(this),
      url: muniUrl + "/search2?f=json",
      displayField: this.simpleSearchSettings.properties.displayField,
      tokenField: this.simpleSearchSettings.properties.tokenField,
      resultsTemplate: this.simpleSearchSettings.properties.template,
      queryParams: [{ key: "st", selector: this._simpleSearchType }],
      noResultsTemplate:
        '<li class="list-group-item disabled" >No properties were found. Try another term or use the Advanced Search option.</li>',
      appendResultsTemplate:
        '<li class="list-group-item text-dark clickable" >If your property is not listed, try the Advanced Search option.</li>',
    });

    // force search terms to clear
    $(".clear-search").on("click", this.clearSearchTerms.bind(this));
    // update simple and advanced search on top level search type change
    $("[name='search-term']").on("change", this.setSearchType.bind(this));
    // on change, allow advanced search to happen when one item has a value
    this._$advancedSearchInputs.on(
      "input",
      this.handleAdvancedInputs.bind(this)
    );
    this._$advancedSearchSelects.on(
      "change",
      this.handleAdvancedInputs.bind(this)
    );

    // permit advanced search
    // date pickers
    $(".date-pick").flatpickr({
      dateFormat: this._dateFormat,
      onChange: this.handleDateChange,
    });
    $("select[name=stpd]").on("change", function () {
      if ($(this).val() !== "all") {
        $(".date-pick").val("");
        $("input[name=psd], input[name=ped]").val(0);
      }
    });
    if (sdlUtils.getParam("st", "properties") !== "properties") {
      this.setSearchType();
    }
    // 508 changes
    document.querySelectorAll("a.nav-link.clear-search").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        const keyDown = e.key !== undefined ? e.key : e.keyCode;
        if (
          keyDown === "Enter" ||
          keyDown === 13 ||
          ["Spacebar", " "].indexOf(keyDown) >= 0 ||
          keyDown === 32
        ) {
          // (prevent default so the page doesn't scroll when pressing space)
          e.preventDefault();
          el.click();
        }
      });
    });
  },

  onSelected: function (selected) {
    "use strict";
    // console.log(selected.url);
    // TESTING
    if (selected) {
      window.location = selected.url;
    } else {
      $(".advanced-search-toggle").collapse("toggle");
    }
  },

  setSearchType: function () {
    "use strict";
    // sets the simple search type
    var st = $("[name='search-term']:checked").val();
    if (!this.simpleSearchSettings[st]) {
      st = "properties";
    }
    $(this._simpleSearchType).val(st); // added as a param for the simple search plugin
    // show/hide search type sections (advanced search)
    $(".search-types").addClass("d-none");
    $(".search-" + st).removeClass("d-none");

    this.simpleSearch.sdlGeneralSearch("clearCache");
    // update template, placeholder text, display field, token field for simple search
    this.simpleSearch.sdlGeneralSearch(
      "updateSetting",
      "resultsTemplate",
      this.simpleSearchSettings[st].template
    );
    this.simpleSearch.sdlGeneralSearch(
      "updateSetting",
      "displayField",
      this.simpleSearchSettings[st].displayField
    );
    this.simpleSearch.sdlGeneralSearch(
      "updateSetting",
      "tokenField",
      this.simpleSearchSettings[st].tokenField
    );
    this.simpleSearch.sdlGeneralSearch(
      "updateSetting",
      "noResultsTemplate",
      this.simpleSearchSettings[st].noResultsTemplate
    );
    this.simpleSearch.sdlGeneralSearch(
      "updateSetting",
      "appendResultsTemplate",
      this.simpleSearchSettings[st].appendResultsTemplate
    );

    this._$simpleSearchInput.prop(
      "placeholder",
      this.simpleSearchSettings[st].placeholder
    );

    this.clearSearchTerms();
  },

  clearSearchTerms: function () {
    "use strict";
    if (!this._$simpleSearchInput.is(":visible")) {
      this._$simpleSearchInput.val("");
    }
    this._$advancedSearchInputs.val("");
    $("input[name=psd], input[name=ped]").val(0);
    this._$advancedFormSubmits.prop("disabled", true);
  },

  handleAdvancedInputs: function () {
    "use strict";
    var $form = $("form:visible");
    var $inputs = $form.find(":input:visible");
    var hasValue = false;
    for (var i = 0; i < $inputs.length; i++) {
      if (
        $inputs.eq(i).val() !== "" &&
        $inputs.eq(i).val() !== undefined &&
        $inputs.eq(i).val() !== 0
      ) {
        hasValue = true;
        break;
      }
    }
    $form.find("button[type=submit]").prop("disabled", !hasValue);
  },

  handleDateChange: function (selectedDates, dateStr, instance) {
    "use strict";
    // handles value transformation of date from calendar to
    var unixDate =
      selectedDates.length > 0
        ? flatpickr.formatDate(selectedDates[0], "U")
        : "";
    var id = this.element.id;
    $("input[name=" + id + "]").val(unixDate);
    $("select[name=stpd]").val("all");
    // clear other date field
    var otherID = id === "ped" ? "psd" : "ped";
    var $otherDate = $("#" + otherID);
    if (
      (id === "ped" && $("[name=" + otherID + "]").val() > unixDate) ||
      (id === "psd" && $("[name=" + otherID + "]").val() < unixDate)
    ) {
      $otherDate.val("");
      $("[name=" + otherID + "]").val(0);
    }
  },
};
SDLSearch.init();
