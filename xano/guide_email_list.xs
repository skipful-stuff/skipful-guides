// "Email me this list" on guides.skipful.com. Public.
// Saves the request and sends one email per address + city per day.
// The email is written here from a fixed template; the only visitor-supplied text in it is the
// city name (letters, spaces and basic punctuation only), so the form can't be used to send arbitrary content.
query guide_email_list verb=POST {
  api_group = "Opportunities"

  input {
    email email filters=trim|lower
    text city filters=trim
    text slug filters=trim|lower
    int followers?
  }

  stack {
    api.lambda {
      code = """
          const email = String($input.email || '');
          const city = String($input.city || '');
          const slug = String($input.slug || '');
          const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120
            && /^[\p{L}][\p{L} .,'-]{0,59}$/u.test(city)
            && /^[a-z0-9-]{2,80}$/.test(slug);
          const f = Number($input.followers) || 0;
          return { day_ago: Date.now() - 864e5, hour_ago: Date.now() - 36e5, ok: ok, followers: (f > 0 && f < 100000000) ? Math.round(f) : null };
        """
      timeout = 5
    } as $check

    precondition ($check.ok == true) {
      error_type = "inputerror"
      error = "Please enter a valid email."
    }

    // Same address + city in the last 24 hours: say ok, don't send again
    db.query guide_leads {
      where = $db.guide_leads.email == $input.email && $db.guide_leads.city == $input.city && $db.guide_leads.created_at > $check.day_ago
      return = {type: "count"}
    } as $recent_same

    // Whole-form cap so it can't be used to blast emails
    db.query guide_leads {
      where = $db.guide_leads.created_at > $check.hour_ago
      return = {type: "count"}
    } as $recent_all

    var $send {
      value = $recent_same == 0 && $recent_all < 100
    }

    db.add guide_leads {
      data = {email: $input.email, city: $input.city, followers: $check.followers, sent: $send}
    } as $lead

    conditional {
      if ($send) {
        api.lambda {
          code = """
              const city = $input.city;
              const slug = $input.slug;
              const f = $var.check.followers;
              const guide = 'https://guides.skipful.com/hotels-that-work-with-influencers/' + slug + '/?utm_source=guide_email&utm_medium=email&utm_campaign=' + slug;
              let signup = 'https://www.skipful.com/signup/?utm_source=guide_email&utm_medium=email&utm_campaign=' + slug + '&city=' + encodeURIComponent(city);
              if (f) signup += '&followers=' + f;
              const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);
              const fitLine = f ? '\n\nYou told us you have about ' + fmt(f) + ' followers. Once you sign up, the hotels that say yes to creators your size are marked for you.' : '';
              const body = 'Hi there,\n\nHere\'s the list you asked for: hotels in ' + city + ' that have already worked with creators.\n\nYour list: ' + guide
                + '\n\nThe guide names the top hotels. Create a free Skipful account to see every hotel\'s name, the creators it hosted and the best email to pitch:\n' + signup
                + fitLine
                + '\n\nGood luck with the pitch.\n\nThe Skipful team';
              return { subject: 'Your list: ' + city + ' hotels that work with creators', body: body };
            """
          timeout = 5
        } as $mail

        api.request {
          url = "https://api.sendgrid.com/v3/mail/send"
          method = "POST"
          params = {}
            |set:"subject":$mail.subject
            |set:"from":({}|set:"email":$env.workspace.sendgrid_from_email|set:"name":"Skipful")
            |set:"content":([]|push:({}|set:"type":"text/plain"|set:"value":$mail.body))
            |set:"personalizations":([]|push:({}|set:"to":([]|push:({}|set:"email":$input.email))))
            |set:"tracking_settings":({}|set:"subscription_tracking":({}|set:"enable":true))
            |set:"categories":([]|push:"guide_email_list")
          headers = []
            |push:"Content-Type: application/json"
            |push:("Authorization: Bearer %s"|sprintf:$env.workspace.sendgrid_api_key)
        } as $res
      }
    }
  }

  response = {ok: true}
}
