(function () {
    
    const URI_PREFIX = 'https://rest.zuora.com/v1';
    
    const dataFormat = 'YYYY-MM-DD';
    const dmm = 'D MMM';
    const dmy = 'D MMMM Y';
    const dmyy = "D MMM 'YY";
    const dmyhm = "D MMM 'YY \\a\\t HH:mm";
    const $aDayPixel = $('<span class="aDay"></span>'); // it's faster to clone than parse.
    const today = moment().startOf('day');
    const matchesHoliday = /holiday/i;
    const matchesDiscount = /discount|percentage|adjustment/i;
    const matchesIssues = /issues/i;
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    Array.prototype.flatMap = function(f) {
        const concat = (x,y) => x.concat(y);
        const flatMap = (f,xs) => xs.map(f).reduce(concat, []);
        return flatMap(f,this);
    };

    function filterOutDiscountsAndAdjustments(rp) {
        return !(matchesDiscount.test(rp.productName) || matchesDiscount.test(rp.ratePlanName));
    }

    function rpcIsDiscount(rpc) {
        return matchesDiscount.test(rpc.model) || matchesDiscount.test(rpc.name);
    }

    function filterOutChargesWithNoEffect(ratePlanIsRemoved) {
        return (rpc) => !(ratePlanIsRemoved && moment(rpc.effectiveStartDate).isSame(rpc.effectiveEndDate));
    }

    function sortRatePlanCharges(rpcA, rpcB) {
        return daysOfWeek.indexOf(rpcA.name) - daysOfWeek.indexOf(rpcB.name);
    }

    function sortRatePlans(rpA, rpB) {
        let dateA = rpA.ratePlanCharges[0].HolidayStart__c || rpA.ratePlanCharges[0].effectiveStartDate;
        let dateB = rpB.ratePlanCharges[0].HolidayStart__c || rpB.ratePlanCharges[0].effectiveStartDate;
        if (dateA === dateB) {
            dateA = rpA.ratePlanCharges[0].HolidayEnd__c || rpA.ratePlanCharges[0].effectiveEndDate;
            dateB = rpB.ratePlanCharges[0].HolidayEnd__c || rpB.ratePlanCharges[0].effectiveEndDate;
        }
        return dateA.localeCompare(dateB);
    }

    function determineCurrency(subscription) {
        if (subscription.ratePlans && subscription.ratePlans[0] && subscription.ratePlans[0].ratePlanCharges && subscription.ratePlans[0].ratePlanCharges[0]) {
            return subscription.ratePlans[0].ratePlanCharges[0].currency;
        } else {
            return 'GBP';
        }
    }

    function renderRatePlanChargeDay($rpc, renderDate, effectiveStartDate, chargedThroughDate, effectiveEndDate, holidayStartDate, holidayEndDate, isBeforeCurrentTerm, isCurrentTerm, isAfterCurrentTerm, isAutoRenewing, isCancelled, isRefundable, isHoliday, isDiscount, isNForN, ratePlanIsRemoved) {
        const hasNoEffectivePeriod = effectiveStartDate.isSame(effectiveEndDate);
        const isWaiting = !isHoliday && renderDate.isBefore(effectiveStartDate);
        const rpcIsRemoved = ratePlanIsRemoved && effectiveEndDate.isBefore(renderDate);
        const isCoveredByRPC = renderDate.isSameOrAfter(effectiveStartDate) && (renderDate.isBefore(effectiveEndDate) || renderDate.isBefore(chargedThroughDate));
        const isGrace = isCurrentTerm && !isHoliday && !isNForN && !isDiscount && !rpcIsRemoved && renderDate.isSameOrAfter(effectiveEndDate);
        const holidayIsActive = isHoliday && renderDate.isSameOrAfter(holidayStartDate) && renderDate.isSameOrBefore(holidayEndDate);
        const holidayIsNotActive = isHoliday && !holidayIsActive;
        const discountIsActive = isDiscount && isCoveredByRPC;
        const discountIsNotActive = isDiscount && !isCoveredByRPC;
        const removedPlanIsNotActive = ratePlanIsRemoved && !isCoveredByRPC;

        let className;
        if (hasNoEffectivePeriod || holidayIsNotActive || removedPlanIsNotActive || discountIsNotActive || (!isCurrentTerm && isWaiting)) {
            className = '';
        } else if (holidayIsActive) {
            className = 'holiday';
        } else if (discountIsActive) {
            className = 'discounted';
        } else if (isGrace) {
            className = 'grace';
        } else if (isCurrentTerm) {
            if (isWaiting) {
                className = 'lead-time';
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
            if (isCoveredByRPC) {
                if (renderDate.isBefore(chargedThroughDate)) {
                    className = renderDate.isSameOrBefore(today) || !isRefundable ? 'covered-not-refundable' : 'covered';
                } else {
                    className = 'scheduled';
                }
            } else {
                className = 'evergreen';
            }
        } else {
            if (isBeforeCurrentTerm) {
                if (renderDate.isBefore(chargedThroughDate)) {
                    className = renderDate.isSameOrBefore(today) || !isRefundable ? 'covered-not-refundable' : 'covered';
                } else {
                    className = 'scheduled';
                }
            } else if (!isCancelled && renderDate.isSameOrBefore(today)) {
                className = 'lost-revenue';
            } else if (isAfterCurrentTerm) {
                className = 'future';
            } else {
                className = ''
            }
        }
        return $aDayPixel.clone().attr('data-date', renderDate.format(dataFormat)).addClass(className);
    }

    function timelineHeaderHtml(subscription) {
        const mechanic = subscription.autoRenew ? 'Auto-renewing' : 'One-off';
        const currentTermLabel = subscription.status === 'Cancelled' ? 'Final term' : 'Current term';
        const futureTermLabel = subscription.status === 'Cancelled' ? 'Year after cancellation' : subscription.autoRenew ? 'Next term' : 'Renewal term';
        return `<tr><th class="term0">&hellip;</th><th class="term1">${currentTermLabel} (<span class="${mechanic.toLowerCase()}">${mechanic}</span>)</th><th class="term2">${futureTermLabel}</th></tr>`
    }

    function legendHtml(earliestRenderDay, notableDates, termStartDate, termEndDate, nextTermEndDate) {
        const $ticksRow = $('<tr class="ticks-row"><td class="ticks" colspan="3"></td></tr>');
        const $ticks = $ticksRow.find('.ticks');
        const $legendRow = $('<tr class="legend-row"><td colspan="3"><div class="legend"></div></td></tr>');
        const $legend = $legendRow.find('.legend');
        const minimumOffset = earliestRenderDay.isBefore(termStartDate) ? 0 : 22; // 22 == width of &hellip;

        let renderDay = earliestRenderDay.clone();
        while (renderDay.isSameOrBefore(nextTermEndDate)) {
            let label = '';
            let className = '';
            if (renderDay.isSame(today)) {
                label = 'Today';
                className = 'today'
            } else if (notableDates.has(renderDay.format(dataFormat))) {
                label = renderDay.format(dmyy);
            }
            if (label) {
                let borders = renderDay.isBefore(termStartDate) ? 1 : renderDay.isBefore(termEndDate) ? 2 : renderDay.isBefore(nextTermEndDate) ? 3 : 4;
                let days = renderDay.diff(earliestRenderDay, 'days');
                let left = minimumOffset + days + borders;
                $ticks.append($('<span class="tick"></span>').addClass(className).offset({left: left}));
                $legend.append(`<date style="left:${left - 1}px;z-index:${-left}" class="${className}">${label}</date>`);
            }
            renderDay.add(1, 'day');
        }
        return [$ticksRow, $legendRow];
    }

    function extractNotableDates(subscription, nextTermEndDate) {
        const notableDates = new Set([
            subscription.termStartDate,
            subscription.termEndDate,
            nextTermEndDate.format(dataFormat),
            today.format(dataFormat)
        ]);

        subscription.ratePlans.forEach(ratePlan => {
            ratePlan.ratePlanCharges.forEach(rpc => {
                if (matchesHoliday.test(rpc.name)) return;
                notableDates.add(rpc.effectiveStartDate);
                notableDates.add(rpc.effectiveEndDate);
                if (rpcIsDiscount(rpc)) return;
                notableDates.add(rpc.chargedThroughDate);
            });
        });

        return notableDates;
    }

    function renderTimeline(subscription) {
        const isAutoRenew = subscription.autoRenew;
        const isCancelled = subscription.status === 'Cancelled';
        const termStartDate = moment(subscription.termStartDate);
        const termEndDate = moment(subscription.termEndDate);
        const nextTermEndDate = termEndDate.clone().add(1, 'years');
        const notableDates = extractNotableDates(subscription, nextTermEndDate);
        const earliestRenderDay = moment(Array.from(notableDates.values()).sort()[0]).startOf('day');
        const preFirstTermLength = termStartDate.diff(earliestRenderDay, 'days');
        const currentTermLength = termEndDate.diff(termStartDate, 'days');
        const nextTermLength = nextTermEndDate.diff(termEndDate, 'days');
        const termLengths = [preFirstTermLength, currentTermLength, nextTermLength];
        const ratePlans = subscription.ratePlans.sort(sortRatePlans);
        const $products = [];

        ratePlans.forEach((ratePlan) => {
            const ratePlanIsRemoved = ratePlan.lastChangeType === 'Remove';
            const ratePlanCharges = ratePlan.ratePlanCharges.filter(filterOutChargesWithNoEffect(ratePlanIsRemoved)).sort(sortRatePlanCharges);
            if (ratePlanCharges.length === 0) return;

            const $chargeLines = $('<tr class="charge-lines"></tr>');
            $products.push($chargeLines);
            let processedDays = 0;

            for (let y = 0; y <= 2; y++) {
                const termLengthInDays = termLengths[y];
                const $chargeLineTerm = $('<td class="aTerm"></td>').addClass(`term${y}`);
                const isBeforeCurrentTerm = (y < 1);
                const isCurrentTerm = (y === 1);
                const isAfterCurrentTerm = (y > 1);
                for (let p = 0; p < ratePlanCharges.length; p++) {
                    const rpc = ratePlanCharges[p];
                    const isRefundable = !/membership/i.test(rpc.name);
                    const isHoliday = matchesHoliday.test(rpc.name);
                    const isDiscount = rpcIsDiscount(rpc);
                    const isNForN = matchesIssues.test(rpc.name);

                    const effectiveStartDate = moment(rpc.effectiveStartDate);
                    const effectiveEndDate = moment(rpc.effectiveEndDate);
                    const holidayStartDate = moment(rpc.HolidayStart__c || rpc.effectiveStartDate);
                    const holidayEndDate = moment(rpc.HolidayEnd__c);
                    const chargedThroughDate = moment(rpc.chargedThroughDate);

                    const holidayDuration = holidayEndDate.diff(holidayStartDate, 'days') + 1 ; // +1 as the holidayEndDate date is inclusive
                    const holidayDurationText = `[${holidayStartDate.format(dmm)}${holidayDuration !== 1 ? `–${holidayEndDate.format(dmm)}` : ''}]`;
                    const name = rpc.name.replace('Credit', holidayDurationText).replace('Percentage', 'Discount').replace(`- ${rpc.billingPeriod}`, '');
                    const period = `${rpc.endDateCondition === "Subscription_End" ? ` / ${rpc.billingPeriod}` : ''}`;
                    const priceOrDiscount = (rpc.price !== null) ? `${rpc.price.toFixed(2)} ${rpc.currency}${period}` : rpc.discountPercentage ? `${rpc.discountPercentage}%` : '';
                    const versionText = rpc.version > 1 ? ` [v${rpc.version}]` : '';
                    const addedText = effectiveStartDate.isSame(effectiveEndDate) ? ` [Added: ${effectiveStartDate.format(dmyy)}]` : '';
                    const removedText = ratePlanIsRemoved ? ` [Removed: ${effectiveEndDate.format(dmyy)}]` : '';
                    const rpcLabel = `${name} ${priceOrDiscount ? `(${priceOrDiscount})` : ''}${versionText}${addedText}${removedText}`;

                    const $rpc = $('<div class="rpc"><div class="rpc-label"></div></div>').width(termLengthInDays);
                    if (isCurrentTerm) $rpc.find(".rpc-label").text(rpcLabel).attr('title', rpc.id);

                    const pixels = [];
                    for (let i = 0; i < termLengthInDays; i++) {
                        const renderDate = earliestRenderDay.clone().add(i + processedDays, 'days');
                        pixels.push(renderRatePlanChargeDay($rpc, renderDate, effectiveStartDate, chargedThroughDate, effectiveEndDate, holidayStartDate, holidayEndDate, isBeforeCurrentTerm, isCurrentTerm, isAfterCurrentTerm, isAutoRenew, isCancelled, isRefundable, isHoliday, isDiscount, isNForN, ratePlanIsRemoved));
                    }
                    $rpc.append(pixels);

                    $chargeLineTerm.append($rpc);
                }
                processedDays += termLengthInDays;
                $chargeLines.append($chargeLineTerm);
            }
        });

        const $multiTermGrid = $('#multi-term-grid');
        $multiTermGrid.html('');
        $multiTermGrid.append(timelineHeaderHtml(subscription));
        $multiTermGrid.append($products);
        $multiTermGrid.append(legendHtml(earliestRenderDay, notableDates, termStartDate, termEndDate, nextTermEndDate));
    }

    function renderCurrentTerm(subscription) {
        const currentTermStartDate = moment(subscription.termStartDate);
        const chargedThroughDates = subscription.ratePlans.filter(filterOutDiscountsAndAdjustments).flatMap(rp => rp.ratePlanCharges.map(rpc => rpc.chargedThroughDate)).sort();
        const earliestChargedThroughDate = moment(chargedThroughDates[0]);
        const termEndDate = moment(subscription.termEndDate);
        const termDuration = termEndDate.diff(currentTermStartDate, 'days');
        const remainingDays = termEndDate.diff(moment(), 'days');
        const remainingHours = termEndDate.diff(moment(), 'h');
        const dayOrDays = Math.abs(remainingDays) === 1 ? 'day' : 'days';
        const hourOrHours = Math.abs(remainingHours) === 1 ? 'hour' : 'hours';

        const termStartDateHtml = `<div>Start date: <date>${currentTermStartDate.format(dmy)}</date></div>`;
        const termDurationHtml = `<div>Duration: ${subscription.currentTerm} ${subscription.currentTermPeriodType}s (${termDuration} days)</div>`;
        const promoCode = subscription.PromotionCode__c ? `<div>${subscription.InitialPromotionCode__c ? 'Renewal promo' : 'Promo'} code: ${subscription.PromotionCode__c}</div>` : '';

        let nextPaymentDate;
        let termEndDateHtml;
        let remainingHtml;
        if (subscription.status === 'Cancelled') {
            const termEndMoment = moment(subscription.termEndDate);
            termEndDateHtml = `<div><strong>${termEndMoment.isSameOrBefore(today) ? 'Ended' : 'Ends'} on</strong>: <date>${termEndMoment.format(dmy)}</date></div>`;
        } else if (subscription.autoRenew) {
            nextPaymentDate = `<div><b>Next payment date</b>: <date>${earliestChargedThroughDate.format(dmy)}</date></div>`;
            termEndDateHtml = `<div>Next term starts: <date>${termEndDate.format(dmy)} (${remainingDays ? remainingDays + ` ${dayOrDays}` : remainingHours + ` ${hourOrHours}`})</date></div>`;
        } else {
            termEndDateHtml = `<div>Last day of service: <date>${termEndDate.clone().subtract(1, 'day').format(dmy)}</date></div>`;
            if (!subscription.autoRenew) {
                termEndDateHtml += `<div><strong>Renewal required</strong>: <date>${termEndDate.format(dmy)}</date></div>`;
                if (remainingDays === 0) {
                    remainingHtml = `<div>${remainingHours > 0 ? `Remaining: ${remainingHours}` : `<b>Overdue</b>: ${0 - remainingHours}`} ${hourOrHours}</div>`;
                } else {
                    remainingHtml = `<div>${remainingDays > 0 ? `Remaining: ${remainingDays}` : `<b>Overdue</b>: ${0 - remainingDays}`} ${dayOrDays}</div>`;
                }
            }
        }

        $('#currentTerm').html('<h3>Current term</h3>').append(termStartDateHtml, termDurationHtml, nextPaymentDate, promoCode, termEndDateHtml, remainingHtml);
    }

    function renderSubscriptionDetails(subscription) {
        const contractEffectiveDateMoment = moment(subscription.contractEffectiveDate);
        const contractEffectiveDate = `<div>Contract effective / acquisition date: <date>${contractEffectiveDateMoment.format(dmy)}</date></div>`;
        const tenure = `<div>Tenure: ${today.diff(contractEffectiveDateMoment, 'day')} days</div>`;
        const subscriptionStartDate = `<div>Subscription start / migration date: <date>${moment(subscription.subscriptionStartDate).format(dmy)}</date></div>`;
        const firstPaymentDate = `<div>First payment date: <date>${moment(subscription.customerAcceptanceDate).format(dmy)}</date></div>`;
        const customerAcceptanceDate = `<div>Customer acceptance date: <date>${moment(subscription.customerAcceptanceDate).format(dmy)}</date></div>`;
        const activationDate = subscription.ActivationDate__c ? `<div>CAS Activation Date: ${moment(subscription.ActivationDate__c).format(dmy)}</div>` : '';

        const currency = determineCurrency(subscription);
        const contractedMRR = `<div>Contracted MRR: ${subscription.contractedMrr} ${currency}</div>`;
        const totalContractedValue = `<div>Total contracted value: ${subscription.totalContractedValue} ${currency}</div>`;
        const readerType = subscription.ReaderType__c ? `<div>Reader type: ${subscription.ReaderType__c}</div>` : '';
        const initialPromoCode = subscription.InitialPromotionCode__c ? `<div>Initial promo code: ${subscription.InitialPromotionCode__c}</div>` : '';
        const supplierCode = subscription.SupplierCode__c ? `<div>Supplier code: ${subscription.SupplierCode__c}</div>` : '';

        $('#details').html('<h3>Details</h3>').append(contractEffectiveDate, tenure, subscriptionStartDate, firstPaymentDate, customerAcceptanceDate, activationDate, contractedMRR, totalContractedValue, readerType, initialPromoCode, supplierCode);
    }

    function renderHeading(subscription) {
        const termEndDate = moment(subscription.termEndDate);
        const isCancelled = subscription.status === 'Cancelled';
        const status = (today.isSameOrAfter(termEndDate) && !isCancelled) ? 'Lapsed' : subscription.status;

        const subscriptionHtml = `<div class="heading-segment">Subscription: ${subscription.subscriptionNumber} <span id="version"></span></div>`;
        const accountHtml = `<div class="heading-segment">Account: ${subscription.accountName}${(subscription.accountNumber !== subscription.accountName) ? ` [#${subscription.accountNumber})` : ''}</div>`;
        const statusHtml = `<div class="heading-segment">Status: <span class="${status.toLowerCase()}">${status}</span></div>`;

        $('#heading').html('').append(subscriptionHtml, accountHtml, statusHtml);
    }

    function renderSubscription(subscription) {
        renderHeading(subscription);
        renderSubscriptionDetails(subscription);
        renderCurrentTerm(subscription);
        renderTimeline(subscription);
    }

    function getAjaxConfig() {
        return {
            dataType: 'json',
            headers: {
                apiAccessKeyId: $('#zuoraUsername').val(),
                apiSecretAccessKey: $('#zuoraPassword').val(),
                Accept: 'application/json'
            }
        };
    }
    
    function fillRocker(subscriptionId) {
        if (!subscriptionId) return;
        $.ajax(`${URI_PREFIX}/object/subscription/${subscriptionId}`, getAjaxConfig()).done(subscriptionObject => {
            $('#versions').prepend(`<option value="${subscriptionObject.Id}">${subscriptionObject.Version} [Created ${moment(subscriptionObject.CreatedDate).format(dmyhm)}]</option>`);
            if (subscriptionObject.Id !== subscriptionObject.OriginalId && subscriptionObject.PreviousSubscriptionId) {
                fillRocker(subscriptionObject.PreviousSubscriptionId);
                $('#versionRocker').show();
            }
        });
    }

    function go(subId) {
        if (!subId) return;
        $.ajax(`${URI_PREFIX}/subscriptions/${subId}`, getAjaxConfig()).done(renderSubscription);
    }

    function start(dataKeyOrSubId) {
        if (!dataKeyOrSubId) return;
        $.ajax(`${URI_PREFIX}/subscriptions/${dataKeyOrSubId}`, getAjaxConfig()).done(subscription => {
            renderSubscription(subscription);
            fillRocker(subscription.id);
        });
    }

    $(document).ready(_ => {
        const backgroundStore = (chrome && chrome.extension) ? chrome.extension.getBackgroundPage().subscriptionViewerStore : {};
        const $loadSubscription = $('#loadSubscription');
        const $inputs = $loadSubscription.find('input');
        const $versions = $('#versions');

        $inputs.each((i, e) => {
            const $target = $(e);
            const id = $target.attr('id');
            if (!id) return;
            $target.val(backgroundStore[id]);
        });
        $inputs.change(e => {
            const $target = $(e.target);
            const id = $target.attr('id');
            if (!id) return;
            backgroundStore[id] = $target.val();
        });
        $versions.change(e => {
            const selectedSubscriptionId = $(e.target).val();
            if (!selectedSubscriptionId) return;
            go(selectedSubscriptionId);
        });
        $loadSubscription.submit(e => {
            e.stopPropagation();
            e.preventDefault();
            $('#versionRocker').hide();
            $versions.html('');
            const subscriptionId = $('#subscriptionId').val();
            if (window.cannedData && window.cannedData[subscriptionId]) {
                renderSubscription(window.cannedData[subscriptionId]);
            } else {
                start(subscriptionId);
            }
        });
        window.resizeTo(1280, 768);
    });
})();