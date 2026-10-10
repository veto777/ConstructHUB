/*
 * JSMin
 * Javascript Compressor
 * http://www.crockford.com/
 * http://www.smallsharptools.com/Projects/Packer/
*/


advancedRecordSearchFindRecordStep=(function(){'use strict';var _step,_findRecordSearchInputId='#FindRecordSearchInput',_findRecordSearchResultsPartialViewId='#FindRecordSearchResultsPartialView',_pageOfFindRecordSearchResultsContainerId='#PageOfFindRecordSearchResultsContainer',_initialAdvancedRecordSearchPageId="#InitialAdvancedRecordSearchPage",_selectedRecordKey,_selectedRecordKeyType,_selectedReferenceKey,_selectedReferenceKeyType;function _changePageOfSearchResults(pageNumber){var searchTerm=_getSearchTerm();_updatePageOfSearchResults(searchTerm,pageNumber);}
function _completeStep(onSuccess,onFailure){if(!_selectedRecordKey||(!_selectedRecordKeyType&&_selectedRecordKeyType!=0)){onFailure(["Unable to determine selected record."]);return;}
$.post('/SiteSearch/UpdateAdvancedRecordSearchFindRecordStep',{recordKey:_selectedRecordKey,recordKeyType:_selectedRecordKeyType,referenceKey:_selectedReferenceKey,referenceKeyType:_selectedReferenceKeyType,advancedRecordSearchSessionGuid:advancedRecordSearchWizard.getAdvancedRecordSearchSessionGuid(),currentPage:_getCurrentPage(),searchText:_getSearchTerm(),bsaOnlineSiteSearchType:_getBsaOnlineSiteSearchType(),},function(data){if(!data.success){onFailure([data.message]);bsaModal.hideLoadingModal();return;}
bsaModal.showLoadingModal("Loading Data...");RedirectToNewPage('/SiteSearch/GoToRecord?advancedRecordSearchSessionGuid='+advancedRecordSearchWizard.getAdvancedRecordSearchSessionGuid());});}
function _getInitialAdvancedRecordSearchPage(){var $initialAdvancedRecordSearchPage=$(_initialAdvancedRecordSearchPageId);if(!$initialAdvancedRecordSearchPage.exists())
return undefined;return $initialAdvancedRecordSearchPage.val();}
function _getSearchTerm(findRecordSearchInput){if(findRecordSearchInput){return $(findRecordSearchInput).val();}
else{var visibleSearchBoxes=document.querySelectorAll(_findRecordSearchInputId+':not(:disabled)')
if(visibleSearchBoxes&&visibleSearchBoxes.length>0)
return $(visibleSearchBoxes)[0].value;else
return $(_findRecordSearchInputId).val();}}
function _getBsaOnlineSiteSearchType(){return $('.ajax-wizard').find(".nav-link.active")[0].parentElement.value;}
function _getCurrentPage(){return $('.find-record-search-results-pager .page-item.active .page-link').attr("value")||1;}
function _initializeStep(){$.get('/SiteSearch/GetAdvancedRecordSearchFindRecordStepPartialView',{advancedRecordSearchSessionGuid:advancedRecordSearchWizard.getAdvancedRecordSearchSessionGuid()},function(partialView){ajaxWizard.updateCurrentStepPartialView(partialView);mdb.Tab.getOrCreateInstance($('#record-search-tab-container'));const recordSearchTabHeaders=document.querySelectorAll('.record-search-container .nav-item');recordSearchTabHeaders.forEach((tabHeader)=>{tabHeader.addEventListener('shown.mdb.tab',_onRecordSearchTabShown);});ManuallyInitializeMdbComponents(null);SetMaskControlVisibility(recordSearchTabHeaders[0],_findRecordSearchInputId,true);var findRecordSearchInputs=document.querySelectorAll(_findRecordSearchInputId);findRecordSearchInputs.forEach((findRecordSearchInput)=>{findRecordSearchInput.setAttribute('aria-describedby','WizardErrorList');$(findRecordSearchInput).bind("keypress",function(e){if(e.keyCode==13){_onSearchClicked(findRecordSearchInput);}});});var searchTerm=_getSearchTerm();var initialAdvancedRecordSearchPage=_getInitialAdvancedRecordSearchPage();if(searchTerm&&initialAdvancedRecordSearchPage){_performSearch(searchTerm,initialAdvancedRecordSearchPage);}});}
function _onRecordSearchTabShown(e){SetMaskControlVisibility($(this)[0],_findRecordSearchInputId,false);}
function _onSearchClicked(findRecordSearchInput){ajaxWizard.clearErrorList();var searchTerm=_getSearchTerm(findRecordSearchInput);if(!searchTerm){ajaxWizard.showErrors(["Please enter a search term to view results"]);var $searchInput=findRecordSearchInput?$(findRecordSearchInput):$(_findRecordSearchInputId+':not(:disabled)').first();$searchInput.focus();return;}
_performSearch(searchTerm);}
function _setDisabledElementsTabIndex(){document.querySelectorAll('[disabled], .disabled').forEach(function(element){element.setAttribute('tabindex','-1');element.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach(function(child){child.setAttribute('tabindex','-1');});});}
function _performSearch(searchTerm,pageNumber){if(!pageNumber)
pageNumber=1;$.get('/SiteSearch/GetAdvancedRecordSearchFindRecordSearchResultsPartialView',{advancedRecordSearchSessionGuid:advancedRecordSearchWizard.getAdvancedRecordSearchSessionGuid()},function(partialView){ajaxWizard.updateCurrentStepAdditionalContentPartialView(partialView);_updatePageOfSearchResults(searchTerm,pageNumber);});}
function _gotToRecord(recordKey,recordKeyType,referenceKey,referenceKeyType){_selectedRecordKey=recordKey;_selectedRecordKeyType=recordKeyType;_selectedReferenceKey=referenceKey;_selectedReferenceKeyType=referenceKeyType;ajaxWizard.goToNextStep();}
function _showLoadingSpinner(){$(_findRecordSearchResultsPartialViewId).addClass("find-record-search-results-loading");$(_pageOfFindRecordSearchResultsContainerId).addClass("find-record-search-results-loading");}
function _updatePageOfSearchResults(searchTerm,page){_showLoadingSpinner();var bsaOnlineSiteSearchType=_getBsaOnlineSiteSearchType()
$.get("/SiteSearch/GetPageOfFindRecordSearchResultsPartialView",{advancedRecordSearchSessionGuid:advancedRecordSearchWizard.getAdvancedRecordSearchSessionGuid(),currentPage:page,searchText:searchTerm,bsaOnlineSiteSearchType:bsaOnlineSiteSearchType},function(partialView){$(_findRecordSearchResultsPartialViewId).html(partialView);$(_findRecordSearchResultsPartialViewId).removeClass("find-record-search-results-loading");_setDisabledElementsTabIndex();});}
return{changePage:_changePageOfSearchResults,extendStep:function(step){_step=step;step.initializeStep=_initializeStep;step.completeStep=_completeStep;},gotToRecord:_gotToRecord,onSearchClicked:_onSearchClicked};})();
