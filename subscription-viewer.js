(function () {

    const dataFormat = 'YYYY-MM-DD';
    const dmy = 'D MMMM Y';
    const aTermHtml = '<td class="aTerm"></td>';
    const rpcHtml = '<div class="rpc"><span class="rpc-label"></span></div>';
    const aDayPixelHtml = '<span class="aDay"></span>';
    const aTickHtml = '<span class="tick"></span>';
    const ticksRowHtml = '<tr><td class="ticks" colspan="2"></td></tr>';
    const legendRowHtml = '<tr><td colspan="2"><div class="legend"></div></td></tr>';
    const today = moment().startOf('day');
    const matchesHoliday = /holiday/i;
    const matchesDiscount = /discount|percentage/i;
    const matchesIssues = /issues/i;

    Array.prototype.flatMap = function(f) {
        const concat = (x,y) => x.concat(y);
        const flatMap = (f,xs) => xs.map(f).reduce(concat, []);
        return flatMap(f,this);
    };

    function sortHomeDeliveryDays(rpcA, rpcB) {
        const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        return daysOfWeek.indexOf(rpcA.name) - daysOfWeek.indexOf(rpcB.name);
    }

    function sortRatePlans(rpA, rpB) {
        if (matchesHoliday.test(rpA.ratePlanName) && matchesHoliday.test(rpB.ratePlanName)) {
            let dateA = rpA.ratePlanCharges[0].effectiveStartDate;
            let dateB = rpB.ratePlanCharges[0].effectiveStartDate;
            if (dateA === dateB) {
                dateA = rpA.ratePlanCharges[0].HolidayEnd__c;
                dateB = rpB.ratePlanCharges[0].HolidayEnd__c;
            }
            return dateA.localeCompare(dateB);
        } else {
            return (matchesDiscount.test(rpA.productName) || matchesDiscount.test(rpA.ratePlanName) || matchesIssues.test(rpA.ratePlanName)) ? 0 : 1;
        }
    }

    function renderRatePlanChargeDay($rpc, renderDate, effectiveStartDate, chargedThroughDate, effectiveEndDate, isCurrentTerm, isAutoRenewing, isCancelled, isRefundable, isHoliday, isDiscount, isNForN) {
        const isWaiting = !isHoliday && isCurrentTerm && renderDate.isBefore(effectiveStartDate);
        const isCoveredByRPC = renderDate.isSameOrAfter(effectiveStartDate) && renderDate.isBefore(effectiveEndDate);
        const isOnHoliday = isHoliday && isCurrentTerm && (renderDate.isSameOrAfter(effectiveStartDate) && renderDate.isSameOrBefore(chargedThroughDate));
        const isGrace = !isHoliday && !isNForN && isCurrentTerm && renderDate.isSameOrAfter(effectiveEndDate);
        const $aDay = $(aDayPixelHtml).attr('data-date', renderDate.format(dataFormat));

        let className;
        if (isHoliday && !isOnHoliday) {
            className = '';
        } else if (isHoliday && isOnHoliday) {
            className = 'holiday';
        } else if (isDiscount) {
            className = 'discounted';
        } else if (isCurrentTerm) {
            if (isWaiting) {
                className = 'lead-time';
            } else if (isGrace) {
                className = 'grace';
            } else if (isCoveredByRPC) {
                if (renderDate.isBefore(chargedThroughDate)) {
                    className = renderDate.isSameOrBefore(today) || !isRefundable ? 'covered-not-refundable' : 'covered';
                } else {
                    className = 'scheduled';
                }
            } else if (!isNForN) {
                className = 'scheduled';
            }
        } else if (isAutoRenewing) {
            className = 'evergreen';
        } else {
            if (!isCancelled && renderDate.isSameOrBefore(today)) {
                className = 'lost-revenue';
            } else {
                className = 'future';
            }
        }
        $aDay.addClass(className);
        $rpc.append($aDay)
    }

    function renderLegend($twoTermGrid, termStartDate, notableDates, termEndDate, nextTermEndDate) {
        const $ticksRow = $(ticksRowHtml);
        const $ticks = $ticksRow.find('.ticks');
        const $legendRow = $(legendRowHtml);
        const $legend = $legendRow.find('.legend');
        let renderDay = termStartDate.clone();
        while (renderDay.isSameOrBefore(nextTermEndDate)) {
            let offset = renderDay.diff(termStartDate, 'days') + ((renderDay.isBefore(termEndDate)) ? 1 : 2); // + 1 or 2 for the left borders!
            let label = 'Today';
            let actuallyRender = false;
            if (renderDay.isSame(today)) {
                actuallyRender = true;
            } else if (notableDates.has(renderDay.format('YYYY-MM-DD'))) {
                label = renderDay.format("D MMM 'YY");
                actuallyRender = true;
            }
            if (actuallyRender) {
                $ticks.append($(aTickHtml).offset({left: offset}));
                $legend.append(`<date style="left:${offset + (renderDay.isSame(today) ? -3 : 0)}px">${label}</date>`);
            }
            renderDay.add(1, 'days');
        }
        $twoTermGrid.append($ticksRow, $legendRow);
    }

    function renderTimeline(subscription) {
        const $twoTermGrid = $('#two-term-grid');
        if ($twoTermGrid.length === 0) return;
        $twoTermGrid.html('');

        const mechanic = subscription.autoRenew ? 'Auto-renewing' : 'One-off';
        const currentTermLabel = subscription.status === 'Cancelled' ? 'Final term' : 'Current term';
        const futureTermLabel = subscription.status === 'Cancelled' ? 'Year after cancellation' : subscription.autoRenew ? 'Next term' : 'Renewal term';

        $twoTermGrid.append(`<tr><th class="term1">${currentTermLabel} (<span class="${mechanic.toLowerCase()}">${mechanic}</span>)</th><th class="term2">${futureTermLabel}</th></tr>`);

        const $ratePlans = [];
        const termStartDate = moment(subscription.termStartDate);
        const termEndDate = moment(subscription.termEndDate);
        const nextTermEndDate = termEndDate.clone().add(1, 'years');
        const firstTermLength = termEndDate.diff(termStartDate, 'days');
        const secondTermLength = nextTermEndDate.diff(termEndDate, 'days');
        const isAutoRenew = subscription.autoRenew;
        const isCancelled = subscription.status === 'Cancelled';
        const notableDates = new Set([
            subscription.termStartDate,
            subscription.termEndDate,
            nextTermEndDate.format('YYYY-MM-DD')
        ]);

        const ratePlans = subscription.ratePlans.sort(sortRatePlans);

        ratePlans.forEach(function(ratePlan) {
            if (ratePlan.lastChangeType === "Remove") return;

            const ratePlanCharges = ratePlan.ratePlanCharges.filter(rpc => moment(rpc.effectiveEndDate).diff(moment(rpc.effectiveStartDate), 'days') > 0).sort(sortHomeDeliveryDays);
            ratePlanCharges.forEach(rpc => {
                if (matchesHoliday.test(rpc.name)) return;
                notableDates.add(rpc.effectiveStartDate);
                notableDates.add(rpc.chargedThroughDate);
                notableDates.add(rpc.effectiveEndDate);
            });

            const $chargeLines = $('<tr class="charge-lines"></tr>');
            $ratePlans.push($chargeLines);

            for (let y = 1; y <= 2; y++) {
                const termLengthInDays = (y === 1) ? firstTermLength : secondTermLength;
                const $chargeLineTerm = $(aTermHtml).addClass(`term${y}`).width(termLengthInDays);
                const isCurrentTerm = (y === 1);
                for (let p = 0; p < ratePlanCharges.length; p++) {
                    const rpc = ratePlanCharges[p];
                    const isRefundable = !/membership/i.test(rpc.name);
                    const isHoliday = matchesHoliday.test(rpc.name);
                    const isDiscount = matchesDiscount.test(rpc.name);
                    const isNForN = matchesIssues.test(rpc.name);

                    const effectiveStartDate = moment(rpc.effectiveStartDate);
                    const effectiveEndDate = moment(rpc.effectiveEndDate);
                    const holidayEndDate = moment(rpc.HolidayEnd__c);
                    const chargedThroughDate = isHoliday ? holidayEndDate : moment(rpc.chargedThroughDate);

                    const holidayDuration = holidayEndDate.diff(effectiveStartDate, 'd');
                    const holidayDurationText = `[${effectiveStartDate.format('D MMM')}${holidayDuration > 1 ? `–${holidayEndDate.format('D MMM')}` : ''}]`;
                    const name = rpc.name.replace("Credit", holidayDurationText).replace('Percentage', 'Discount');
                    const period = `${rpc.endDateCondition === "Subscription_End" ? ` / ${rpc.billingPeriod}` : ''}`;
                    const priceOrDiscount = (rpc.price !== null) ? `${rpc.price.toFixed(2)} ${rpc.currency}${period}` : rpc.discountPercentage ? `${rpc.discountPercentage}%` : '';
                    const rpcLabel = `${name} ${priceOrDiscount ? `(${priceOrDiscount})` : ''}`;
                    const $rpc = $(rpcHtml);
                    if (y === 1) $rpc.find(".rpc-label").text(rpcLabel);

                    let timelineDaysPresented = (y === 1) ? 0 : firstTermLength;
                    for (let i = 0; i < termLengthInDays; i++) {
                        const renderDate = termStartDate.clone().add(timelineDaysPresented, 'd');
                        renderRatePlanChargeDay($rpc, renderDate, effectiveStartDate, chargedThroughDate, effectiveEndDate, isCurrentTerm, isAutoRenew, isCancelled, isRefundable, isHoliday, isDiscount, isNForN);
                        timelineDaysPresented++;
                    }
                    $chargeLineTerm.append($rpc);
                }
                $chargeLines.append($chargeLineTerm);
            }
        });


        $twoTermGrid.append($ratePlans).width(firstTermLength + secondTermLength + 3);
        renderLegend($twoTermGrid, termStartDate, notableDates, termEndDate, nextTermEndDate);
    }

    function renderCurrentTerm(subscription) {
        const $currentTerm =  $('#currentTerm');
        if ($currentTerm.length === 0) return;
        $currentTerm.html('');

        const termStartDate = moment(subscription.termStartDate);
        const chargedThroughDates = subscription.ratePlans.filter(rp => rp.productName !== 'Discounts').flatMap(rp => rp.ratePlanCharges.map(rpc => rpc.chargedThroughDate)).sort();
        const earliestChargedThroughDate = moment(chargedThroughDates[0]);
        const termEndDate = moment(subscription.termEndDate);
        const termDuration = termEndDate.diff(termStartDate, 'd');
        const remaining = termEndDate.diff(today, 'd');

        const header = '<h3>Current term</h3>';
        const termStartDateHtml = `<div>Start date: <date>${termStartDate.format(dmy)}</date></div>`;
        const termDurationHtml = `<div>Duration: ${subscription.currentTerm} ${subscription.currentTermPeriodType}s (${termDuration} days)</div>`;

        let nextPaymentDate;
        let termEndDateHtml;
        let remainingHtml;
        if (subscription.status === 'Cancelled') {
            termEndDateHtml = `<div><strong>Cancelled</strong>: <date>${moment(subscription.termEndDate).format(dmy)}</date></div>`;
        } else if (subscription.autoRenew) {
            nextPaymentDate = `<div><b>Next payment date</b>: <date>${earliestChargedThroughDate.format(dmy)}</date></div>`;
            termEndDateHtml = `<div>Next term starts: <date>${termEndDate.format(dmy)} (${remaining} days)</date></div>`;
        } else {
            termEndDateHtml = `<div>Last day of service: <date>${termEndDate.clone().subtract(1, 'days').format(dmy)}</date></div>`;
            if (!subscription.autoRenew) {
                termEndDateHtml += `<div><strong>Renewal required</strong>: <date>${termEndDate.format(dmy)}</date></div>`;
                remainingHtml = remaining !== 0 &&`<div>${remaining > 0 ? `Remaining: ${remaining}` : `<b>Overdue</b>: ${0 - remaining}`} days</div>`;
            }
        }
        $currentTerm.append(header, termStartDateHtml, termDurationHtml, nextPaymentDate, termEndDateHtml, remainingHtml);
    }

    function renderSubscriptionDetails(subscription) {
        const $details = $('#details');
        if ($details.length === 0) return;
        $details.html('<h3>Details</h3>');

        const contractEffectiveDate = `<div>Contract effective / acquisition date: <date>${moment(subscription.contractEffectiveDate).format(dmy)}</date></div>`;
        const subscriptionStartDate = `<div>Subscription start / migration date: <date>${moment(subscription.subscriptionStartDate).format(dmy)}</date></div>`;
        const firstPaymentDate = `<div>First payment date: <date>${moment(subscription.customerAcceptanceDate).format(dmy)}</date></div>`;
        const customerAcceptanceDate = `<div>Customer acceptance date: <date>${moment(subscription.customerAcceptanceDate).format(dmy)}</date></div>`;
        const activationDate = subscription.ActivationDate__c ? `<div>CAS Activation Date: ${moment(subscription.ActivationDate__c).format(dmy)}</div>` : '';

        const readerType = subscription.ReaderType__c ? `<div>Reader type: ${subscription.ReaderType__c}</div>` : '';
        const initialPromoCode = subscription.InitialPromotionCode__c ? `<div>Initial promo code: ${subscription.InitialPromotionCode__c}</div>` : '';
        const promoCode = subscription.PromotionCode__c ? `<div>${subscription.InitialPromotionCode__c ? 'Renewal promo' : 'Promo'} code: ${subscription.PromotionCode__c}</div>` : '';
        const supplierCode = subscription.SupplierCode__c ? `<div>Supplier code: ${subscription.SupplierCode__c}</div>` : '';

        $details.append(contractEffectiveDate, subscriptionStartDate, firstPaymentDate, customerAcceptanceDate, activationDate, readerType, initialPromoCode, promoCode, supplierCode);
    }

    function renderHeading(subscription) {
        const $heading = $('#heading');
        if ($heading.length === 0) return;

        const $h2 = $('<h2></h2>');
        const termEndDate = moment(subscription.termEndDate);
        const isCancelled = subscription.status === 'Cancelled';
        const status = (today.isSameOrAfter(termEndDate) && !isCancelled) ? 'Lapsed' : subscription.status;

        const subscriptionHtml = `<div class="heading-segment">Subscription: ${subscription.subscriptionNumber}</div>`;
        const accountHtml = `<div class="heading-segment">Account: ${subscription.accountName}${(subscription.accountNumber !== subscription.accountName) ? ` (#${subscription.accountNumber})` : ''}</div>`;
        const statusHtml = `<div class="heading-segment">Status: <span class="${status.toLowerCase()}">${status}</span></div>`;

        $h2.append(subscriptionHtml, statusHtml, accountHtml);

        $heading.html($h2)
    }

    function renderSubscription(subscription) {
        renderHeading(subscription);
        renderSubscriptionDetails(subscription);
        renderCurrentTerm(subscription);
        renderTimeline(subscription);
    }

    function go(dataKeyOrSubId) {
        if (!dataKeyOrSubId) return;
        $.ajax(`https://api.zuora.com/rest/v1/subscriptions/${dataKeyOrSubId}`, {
            crossDomain: true,
            headers: {
                apiAccessKeyId: $('#zuoraUsername').val(),
                apiSecretAccessKey: $('#zuoraPassword').val(),
                Accept: 'application/json'
            }
        }).done(renderSubscription);
    }

    $(document).ready(function () {
        const backgroundStore = (chrome && chrome.extension) ? chrome.extension.getBackgroundPage().subscriptionViewerStore : {};
        const $loadSubscription = $('#loadSubscription');
        const $inputs = $loadSubscription.find('input');
        $inputs.each(function () {
            const $target = $(this);
            const id = $target.attr('id');
            if (!id) return;
            $target.val(backgroundStore[id]);
        });
        $inputs.change(function (e) {
            const $target = $(e.target);
            const id = $target.attr('id');
            if (!id) return;
            backgroundStore[id] = $target.val();
        });
        $loadSubscription.submit((e) => {
            e.stopPropagation();
            e.preventDefault();
            const subscriptionId = $(this).find('#subscriptionId').val();
            if (window.cannedData && window.cannedData[subscriptionId]) {
                renderSubscription(window.cannedData[subscriptionId]);
            } else {
                go(subscriptionId);
            }
        });
        window.resizeTo(1280, 768);
    });
})();