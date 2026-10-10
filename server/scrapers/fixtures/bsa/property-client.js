$(document).ready(function () {
	cdSiteSearchPropertyResult.initializeView();
});

var cdSiteSearchPropertyResult = (function () {
	'use strict';

	var _cdTabSelectedId = '#CdTabSelected',
		_currentPropertyAddressSpanId = '#CurrentPropertyAddress',
		_parcelNumberId = '#ParcelNumber',
		_propertyAddressDisplayAddressId = '#Property_Address_DisplayAddress',
		_propertyDetailsDivId = '#PropertyDetails',
		_propertyRecordKeyId = '#PropertyRecordKey',
		_propertyDetailsHeaderAddressId = '#PropertyDetailsHeaderAddress',
		_subPageAuthTokenId = '#SubPageAuthToken',
		_subPageAuthReferenceKeyId = '#SubPageAuthReferenceKey';

	function _getCdTabSelected() {
		return $(_cdTabSelectedId).val();
	}

	function _getPropertyRecordKey() {
		return $(_propertyRecordKeyId).val();
	}

	function _getSubPageAuthToken() {
		return $(_subPageAuthTokenId).val();
	}

	function _getSubPageAuthReferenceKey() {
		return $(_subPageAuthReferenceKeyId).val();
	}

	function _initializePropertyView() {
		//Only initialize if page is not already rendered 
		if ($(_propertyDetailsDivId).html())
			return;

		var propertyRecordKey = _getPropertyRecordKey();

		if (!propertyRecordKey)
			return;

		_updatePropertyDetails(propertyRecordKey);
	}

	function _onPropertySelected(propertyRecordKey) {
		if (propertyRecordKey)
			_updatePropertyDetails(propertyRecordKey);
	}

	function _updateCurrentPropertyAddress() {
		$(_currentPropertyAddressSpanId).html($(_propertyAddressDisplayAddressId).val());
		$(_propertyDetailsHeaderAddressId).html($(_propertyAddressDisplayAddressId).val());
	}

	function _updatePropertyDetails(propertyRecordKey) {

		bsaModal.showLoadingModal('Loading Data...', 'Loading property details, please wait.');

		// SubPageAuthToken + ReferenceKey are validated server-side by [SubPageAuthorization] to ensure this
		// detail request came from the hosting parent page and not a bot hitting the endpoint directly.
		$.get('/CD_PropertySearchV3/PropertyAndParcelDetails', {
			recordKey: propertyRecordKey,
			SubPageAuthToken: _getSubPageAuthToken(),
			ReferenceKey: _getSubPageAuthReferenceKey()
		}, function (partial) {
			$(_propertyDetailsDivId).html(partial);

			_updateCurrentPropertyAddress();

			bsaModal.hideLoadingModal();
		});
	}

	return {
		initializeView: function () {
			if (_getCdTabSelected() === "True") {
				_initializePropertyView();
			}
		},

		onCdTabSelect: function () {
			_initializePropertyView();
		},

		selectProperty: function () {
			cdSiteSearchPropertySelectModal.showModal(_onPropertySelected, $(_parcelNumberId).val());
		}
	};
})();